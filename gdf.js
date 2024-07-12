import fs from 'node:fs'
import url from 'node:url'
import path from 'node:path'
import * as readline from 'node:readline'
import { execSync } from 'node:child_process'

import * as ejs from 'ejs'
import chalk from 'chalk'
import * as Diff from 'diff'
import * as ShellQuote from 'shell-quote'

// defaults for all the flags that will be saved
export const defaults = {
  alpine: false,
  bun: false,
  build: '',
  cache: false,
  cmd: '',
  deferBuild: false,
  dev: false,
  entrypoint: '',
  distroless: false,
  ignoreScripts: false,
  legacyPeerDeps: false,
  link: true,
  litefs: false,
  nginxRoot: '',
  port: 0,
  swap: '',
  windows: false,

  packages: { base: [], build: [], deploy: [] },
  vars: { base: {}, build: {}, deploy: {} },
  args: { base: {}, build: {}, deploy: {} },
  instructions: { base: null, build: null, deploy: null },
  secrets: []
}

const ALPINE_MAPPINGS = {
  'build-essential': 'build-base',
  'chromium-sandbox': 'chromium-chromedriver',
  'node-gyp': 'gyp',
  'pkg-config': 'pkgconfig',
  python: 'python3',
  'python-is-python3': 'python3',
  sqlite3: 'sqlite'
}

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// Generate Dockerfile class
export class GDF {
  static templates = path.join(__dirname, 'templates')
  static runners = []

  // enable geneator to be extended via mixins
  static extend(mixin) {
    const descriptors = Object.getOwnPropertyDescriptors(mixin.prototype)

    for (const [method, descriptor] of Object.entries(descriptors)) {
      if (method === 'run') {
        this.runners.push(descriptor.value)
      } else if (method !== 'constructor') {
        Object.defineProperty(this.prototype, method, descriptor)
      }
    }
  }

  // Where the app is.  Used both for scanning and is updated with new files.
  _appdir = null

  // Parsed package.json file contents.
  #pj

  // which packager is used (npm, pnpm, yarn)
  #packager

  // previous answer to conflict prompt
  #answer = ''

  get variant() {
    return this.options.alpine ? 'alpine' : 'slim'
  }

  alpinize(packages) {
    packages = packages.map(name => ALPINE_MAPPINGS[name] || name)
    return [...new Set(packages)].sort()
  }

  get pkg_update() {
    return this.options.alpine ? 'apk update' : 'apt-get update -qq'
  }

  get pkg_install() {
    return this.options.alpine ? 'apk add' : 'apt-get install --no-install-recommends -y'
  }

  get pkg_cache() {
    let caches

    if (this.options.alpine) {
      caches = { cache: '/var/cache/apk' }
    } else {
      caches = {
        cache: '/var/cache/apt',
        lib: '/var/lib/apt'
      }
    }

    return Object.entries(caches).map(([name, path]) =>
      `--mount=type=cache,id=${name},target=${path} \\`
    ).join('\n    ')
  }

  get pkg_cleanup() {
    return this.options.alpine ? '/var/cache/apk/*' : '/var/lib/apt/lists /var/cache/apt/archives'
  }

  get astro() {
    return !!(this.#pj.dependencies?.astro)
  }

  get astroSSR() {
    return !!(this.#pj.dependencies?.astro) &&
      !!(this.#pj.dependencies?.['@astrojs/node'])
  }

  get astroStatic() {
    return this.astro && !this.astroSSR
  }

  get svelte() {
    return !!(this.#pj.devDependencies?.['@sveltejs/kit'])
  }

  get vite() {
    return !!(this.#pj.scripts?.dev === 'vite')
  }

  // Does this application use remix.run?
  get remix() {
    return !!(this.#pj.dependencies?.remix ||
      this.#pj.dependencies?.['@remix-run/node'])
  }

  // Is this an EpicStack application?
  get epicStack() {
    return !!this.#pj['epic-stack']
  }

  // Does this application use prisma?
  get prisma() {
    return !!(this.#pj.dependencies?.['@prisma/client'] ||
      this.#pj.devDependencies?.prisma)
  }

  get meteor() {
    return !!this.#pj.dependencies?.['meteor-node-stubs']
  }

  // Does this application use next.js?
  get nextjs() {
    return !!this.#pj.dependencies?.next
  }

  get standaloneNextjs() {
    if (!this.nextjs) return false

    if (fs.existsSync(path.join(this._appdir, 'next.config.mjs'))) {
      const config = fs.readFileSync(path.join(this._appdir, 'next.config.mjs'), 'utf-8')
      return /output\s*:\s*(["'`])standalone\1/.test(config)
    } else if (fs.existsSync(path.join(this._appdir, 'next.config.js'))) {
      const config = fs.readFileSync(path.join(this._appdir, 'next.config.js'), 'utf-8')
      return /output\s*:\s*(["'`])standalone\1/.test(config)
    } else return false
  }

  // Does this application use nuxt.js?
  get nuxtjs() {
    return !!this.#pj.dependencies?.nuxt
  }

  // Does this application use gatsby?
  get gatsby() {
    return !!this.#pj.dependencies?.gatsby
  }

  // Does this application use adonisjs?
  get adonisjs() {
    return !!this.#pj.dependencies?.['@adonisjs/core']
  }

  get adonisjsFileUpload() {
    if (!fs.existsSync(path.join(this._appdir, 'config/drive.ts'))) {
      return false
    }

    const driveConfig = fs.readFileSync(path.join(this._appdir, 'config/drive.ts'), 'utf8')
    return driveConfig.includes("Application.tmpPath('uploads')")
  }

  // Does this application use postgres?
  get postgres() {
    if (this.prisma) {
      try {
        const schema = fs.readFileSync(path.join(this._appdir, 'prisma/schema.prisma'), 'utf-8')
        if (/^\s*provider\s*=\s*"postgresql"/m.test(schema)) return true
      } catch {
      }
    }

    return this.adonisjs && !!this.#pj.dependencies?.pg
  }

  // Does this application use nest?
  get nestjs() {
    return !!this.#pj.dependencies?.['@nestjs/core']
  }

  // Does this application use sqlite3?
  get sqlite3() {
    if (this.prisma) {
      try {
        const schema = fs.readFileSync(path.join(this._appdir, 'prisma/schema.prisma'), 'utf-8')
        if (/^\s*provider\s*=\s*"sqlite"/m.test(schema)) return true
      } catch {
      }
    }

    return !!this.#pj.dependencies?.sqlite3 ||
      !!this.#pj.dependencies?.['better-sqlite3'] ||
      this.litefs
  }

  // Does this application use litefs?
  get litefs() {
    return this.options.litefs ||
      !!this.#pj.dependencies?.['litefs-js']
  }

  // Does this application use puppeteer?
  get puppeteer() {
    return !!this.#pj.dependencies?.puppeteer ||
      !!this.#pj.dependencies?.['puppeteer-core']
  }

  // Packages needed for base stage
  get basePackages() {
    const packages = [...this.options.packages.base]

    if (this.options.alpine) {
      return this.alpinize(packages)
    } else {
      return packages.sort()
    }
  }

  // Packages needed for build stage
  get buildPackages() {
    const packages = ['pkg-config', 'build-essential', this.python]

    if (!this.bun) {
      packages.push('node-gyp')
    }

    if (this.meteor) {
      packages.push('python3-pip', 'g++', 'make', 'curl')
    }

    // https://docs.npmjs.com/cli/v10/configuring-npm/package-json#git-urls-as-dependencies
    if (Object.values(this.#pj.dependencies || {}).some(value => /^git(\+|:|hub:)|^\w+\//.test(value))) {
      packages.push('git')
    } else if (((this.build || this.dev || this.options.deferBuild) && Object.values(this.#pj.devDependencies || {}).some(value => /^git(\+|:|hub:)|^\w+\//.test(value)))) {
      packages.push('git')
    }

    if (this.prisma) packages.push('openssl')

    packages.push(...this.options.packages.build)

    if (this.options.alpine) {
      return this.alpinize(packages)
    } else {
      return packages.sort()
    }
  }

  // Does the build script require node?
  // This is just an approximation, but too many build scripts actually require node.
  get bunNode() {
    if (!this.bun) return false

    const build = this.#pj.scripts?.build

    if (build && fs.existsSync(path.join(this._appdir, `node_modules/.bin/${build.split(' ')[0]}`))) {
      const script = fs.readFileSync(path.join(this._appdir, `node_modules/.bin/${build.split(' ')[0]}`), 'utf-8')
      return /^#!.*node/.test(script)
    }

    return false
  }

  // packages needed for deploy stage
  get deployPackages() {
    const packages = [...this.options.packages.deploy]

    if (this.litefs) packages.push('ca-certificates', 'fuse3')
    if (this.remix && this.sqlite3) packages.push('sqlite3')
    if (this.prisma) packages.push('openssl')
    if (this.options.nginxRoot) packages.push('nginx')
    if (this.#pj.dependencies?.['fluent-ffmpeg']) packages.push('ffmpeg')
    if (this.puppeteer) packages.push('chromium', 'chromium-sandbox')

    if (this.options.alpine) {
      return this.alpinize(packages)
    } else {
      return packages.sort()
    }
  }

  sortEnv(env) {
    if (Object.values(env).some(value => value.toString().includes('$'))) {
      return Object.entries(env)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join('\nENV ')
    } else {
      return Object.entries(env).sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join(' \\\n    ')
    }
  }

  get buildCache() {
    if (!this.options.cache) return ''

    let id = 'npm'
    let target = '/app/.npm'

    if (this.yarn) {
      id = 'yarn'
      if (this.yarnVersion.startsWith('1.')) {
        target = '/usr/local/share/.cache/yarn/'
      } else {
        target = '/app/.yarn/berry/cache'
      }
    } else if (this.pnpm) {
      id = 'pnpm'
      target = '/pnpm/store'
    } else if (this.bun) {
      id = 'bun'
      target = '/root/.bun'
    }

    return `--mount=type=cache,id=${id},target=${target} \\\n    `
  }

  get baseEnv() {
    const env = {
      NODE_ENV: 'production'
    }

    return { ...this.options.vars.base, ...env }
  }

  get buildEnv() {
    let env = {}

    if (this.options.cache && this.pnpm) {
      env = {
        PNPM_HOME: '/pnpm',
        PATH: '$PNPM_HOME:$PATH'
      }
    }

    return { ...this.options.vars.build, ...env }
  }

  get deployEnv() {
    const env = {}

    if (this.sqlite3) {
      if (this.epicStack) {
        env.DATABASE_FILENAME = 'sqlite.db'
        env.LITEFS_DIR = '/litefs'
        env.DATABASE_PATH = '$LITEFS_DIR/$DATABASE_FILENAME'
        env.DATABASE_URL = 'file://$DATABASE_PATH'
        env.CACHE_DATABASE_FILENAME = 'cache.db'
        env.CACHE_DATABASE_PATH = '$LITEFS_DIR/$CACHE_DATABASE_FILENAME'
        env.PORT = this.port + 1
      } else {
        env.DATABASE_URL = `file:///${this.litefs ? 'litefs' : 'data'}/sqlite.db`
        if (this.litefs) env.PORT = this.port + 1
      }
    }

    if (this.nuxtjs) {
      env.HOST = 0
    }

    if (this.adonisjs) {
      env.HOST = '0.0.0.0'
      env.PORT = '3000'
      env.CACHE_VIEWS = 'true'
      env.SESSION_DRIVER = 'cookie'
      env.DRIVE_DISK = 'local'
      if (this.postgres) env.DB_CONNECTION = 'pg'
    }

    if (this.puppeteer) env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium'

    return { ...this.options.vars.deploy, ...env }
  }

  emitEnv(env) {
    if (Object.values(env).some(value => value.toString().includes('$'))) {
      return 'ENV ' + Object.entries(env)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join('\nENV ')
    } else {
      return 'ENV ' + Object.entries(env).sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join(' \\\n    ')
    }
  }

  emitArgs(args) {
    return 'ARG ' + Object.entries(args)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join(' \\\n    ')
  }

  get mountSecrets() {
    if (this.options.secrets.length === 0) return ''

    const lines = []

    for (const secret of this.options.secrets) {
      lines.push(`--mount=type=secret,id=${secret}`)
    }

    for (const secret of this.options.secrets) {
      lines.push(`${secret}="$(cat /run/secrets/${secret})"`)
    }

    lines.push('')

    return lines.join(' \\\n    ')
  }

  // what node version should be used?
  get nodeVersion() {
    const ltsVersion = '20.15.0'

    let version = process.version.match(/\d+\.\d+\.\d+/)?.[0] || ltsVersion

    if (this.#pj.engines?.node) {
      // determine minimal version from package.json
      const { node } = this.#pj.engines
      const minversion = node.match(/\d+(\.\d+(\.\d+)?)?/)?.[0].split('.')
      if (node.includes('>') && !node.includes('=')) {
        minversion.push(parseInt(minversion.pop()) + 1)
      }

      // ensure version is at least the minimum
      version = version.split('.')
      for (let i = 0; i < version.length; i++) {
        if (minversion[i] > version[i]) {
          version = minversion
          break
        } else if (minversion[i] < version[i]) {
          break
        }
      }

      version = version.join('.')
    }

    return version
  }

  // what bun version should be used?
  get bunVersion() {
    if (this.#packager !== 'bun') return

    try {
      return execSync('bun --version', { encoding: 'utf8' })
        .match(/\d+\.\d+\.\d+/)?.[0]
    } catch {
    }
  }

  // classic version of yarn (installed by default)
  yarnClassic = '1.22.21'

  // What yarn version should be used?
  get yarnVersion() {
    const version = this.#pj.packageManager?.match(/(\d+\.\d+\.\d+)/)?.[0] // Should return something like "1.22.10"

    if (version !== undefined) {
      return version
    } else {
      try {
        return execSync('yarn --version', { encoding: 'utf8' })
          .match(/\d+\.\d+\.\d+/)?.[0] || this.yarnClassic
      } catch {
        return this.yarnClassic
      }
    }
  }

  // What pnpm version should be used?
  get pnpmVersion() {
    try {
      return execSync('pnpm --version', { encoding: 'utf8' })
        .match(/\d+\.\d+\.\d+/)?.[0] || 'latest'
    } catch {
      return 'latest'
    }
  }

  // Use gcr.io distroless base image?
  get distroless() {
    if (!this.options.distroless) return false

    if (this.entrypoint) return false

    const version = parseInt(this.nodeVersion)
    return (version >= 16)
  }

  // List of package files needed to install
  get packageFiles() {
    const result = ['package.json']

    const files = [
      'package-lock.json', '.npmrc',
      'pnpm-lock.yaml',
      'yarn.lock', '.yarnrc', '.yarnrc.yml',
      'bun.lockb'
    ]

    for (const file of files) {
      if (fs.existsSync(path.join(this._appdir, file))) {
        result.push(file)
      }
    }

    return result.sort()
  }

  // Which packager should be used?
  get packager() {
    if (this.#packager !== undefined) return this.#packager

    const packageFiles = this.packageFiles

    if (packageFiles.includes('bun.lockb')) {
      this.#packager = 'bun'
    } else if (packageFiles.includes('pnpm-lock.yaml')) {
      this.#packager = 'pnpm'
    } else if (packageFiles.includes('yarn.lock')) {
      this.#packager = 'yarn'
    } else if (typeof Bun !== 'undefined') {
      this.#packager = 'bun'
    } else if (packageFiles.includes('package-lock.json')) {
      this.#packager = 'npm'
    } else {
      this.#packager = 'npm'
    }

    return this.#packager
  }

  // install modules needed to run
  installModules() {
    const modules = []

    if (this.options.nginxRoot && !this.#pj.dependencies?.foreman) {
      modules.push('foreman')
    }

    if (modules.length === 0) return
    const add = this.packager === 'npm' ? 'install' : 'add'
    for (const module of modules) {
      execSync(`${this.packager} ${add} ${module}`, { stdio: 'inherit' })
    }
  }

  // install all dependencies in package.json
  get packagerInstall() {
    let install = `${this.packager} install`

    const packageFiles = this.packageFiles

    // clean install
    if (this.packager === 'npm' && packageFiles.includes('package-lock.json')) {
      install = 'npm ci'
    } else if (packageFiles.includes('yarn.lock')) {
      if (this.yarnVersion.startsWith('1.')) {
        install += ' --frozen-lockfile'
      } else if (this.yarnVersion.startsWith('2.')) {
        install += ' --immutable --immutable-cache --check-cache'
      } else {
        // yarn 3+
        install += ' --immutable'
      }
    } else if (packageFiles.includes('pnpm-lock.yaml')) {
      install += ' --frozen-lockfile'
    }

    // optionally include dev dependencies if a build is defined
    if (this.build || this.dev || this.options.deferBuild) {
      if (this.devDependencies) {
        if (this.yarn) {
          install += ' --production=false'
        } else if (this.pnpm) {
          install += ' --prod=false'
        } else if (!this.bunVersion) {
          install += ' --include=dev'
        }
      }
    } else {
      if (this.bunVersion) {
        install += ' --ci'
      }
    }

    // optionally include legacy peer dependencies
    if (this.options.legacyPeerDeps) {
      if (this.npm) {
        install += ' --legacy-peer-deps'
      } else if (this.yarn && !this.yarnVersion.startsWith('1.')) {
        install += ' --legacy-peer-deps'
      }
    }

    // optionally include scripts
    if (this.options.ignoreScripts) {
      install += ' --ignore-scripts'
    }

    return install
  }

  // Prune development dependencies
  get packagerPrune() {
    let prune

    if (this.yarn) {
      prune = 'yarn install --production=true'

      if (this.options.legacyPeerDeps && !this.yarnVersion.startsWith('1.')) {
        prune += ' --legacy-peer-deps'
      }
    } else if (this.pnpm) {
      prune = 'pnpm prune --prod'
    } else if (this.bunVersion) {
      prune = 'rm -rf node_modules && \\\n    bun install --ci'
    } else {
      prune = 'npm prune --omit=dev'

      if (this.options.legacyPeerDeps) prune += ' --legacy-peer-deps'
    }

    return prune
  }

  // Is the packager yarn?
  get yarn() {
    return this.packager === 'yarn'
  }

  // Is the packager npm?
  get npm() {
    return this.packager === 'npm'
  }

  // Is the packager pnpm?
  get pnpm() {
    return this.packager === 'pnpm'
  }

  // Is the packager bun?
  get bun() {
    return this.options.bun || this.packager === 'bun'
  }

  // How to install python (switched from buster to bullseye)
  get python() {
    return parseInt(this.nodeVersion.split('.')[0]) > 16 ? 'python-is-python3' : 'python'
  }

  // Are there any development dependencies?
  get devDependencies() {
    return !!this.#pj.devDependencies
  }

  // Include devDependencies?
  get dev() {
    if (!this.devDependencies) return false

    // frameworks that include migration dependencies in devDependencies
    if (this.nestjs) return true
    if (this.adonisjs) return true

    return this.options.dev
  }

  // Is there a build script?
  get build() {
    if (this.options.build) return this.options.build
    if (this.#pj.scripts?.build) {
      if (this.packager === 'bun' && this.bunNode) {
        return 'bun --bun run build'
      } else {
        return `${this.packager} run build`
      }
    }
  }

  // Descriptive form of detected runtime
  get runtime() {
    let runtime = 'Node.js'

    if (this.astro) runtime = 'Astro'
    if (this.vite) runtime = 'Vite'
    if (this.bunVersion) runtime = 'Bun'
    if (this.remix) runtime = 'Remix'
    if (this.meteor) runtime = 'Meteor'
    if (this.nextjs) runtime = 'Next.js'
    if (this.nuxtjs) runtime = 'Nuxt'
    if (this.nestjs) runtime = 'NestJS'
    if (this.gatsby) runtime = 'Gatsby'
    if (this.svelte) runtime = 'SvelteKit'
    if (this.adonisjs) runtime = 'AdonisJS'

    if (this.prisma) runtime += '/Prisma'

    return runtime
  }

  get user() {
    return this.runtime.split('/')[0].replaceAll('.', '').toLowerCase()
  }

  get foreman() {
    if (this.options.nginxRoot) return true
  }

  get npx() {
    return this.bun ? 'bunx' : 'npx'
  }

  // command to start the web server
  get startCommand() {
    if (this.options.cmd) return this.options.cmd

    if (this.options.distroless) {
      const start = this.#pj.scripts.start
      const parsed = ShellQuote.parse(start)
      return parsed
    }

    if (this.adonisjs) {
      return ['node', '/app/build/server.js']
    } else if (this.nuxtjs) {
      return ['node', '.output/server/index.mjs']
    } else if (this.meteor) {
      return ['node', 'main.js']
    } else if (this.gatsby) {
      return [this.npx, 'gatsby', 'serve', '-H', '0.0.0.0']
    } else if (this.vite || this.astroStatic) {
      return ['/usr/sbin/nginx', '-g', 'daemon off;']
    } else if (this.astroSSR) {
      return ['node', './dist/server/entry.mjs']
    } else if (this.runtime === 'Node.js' && this.#pj.scripts?.start?.includes('fastify')) {
      let start = this.#pj.scripts.start
      if (!start.includes('-a') && !start.includes('--address')) {
        start = start.replace('start', 'start --address 0.0.0.0')
      }

      start = start.split(' ')
      start.unshift(this.npx)
      return start
    } else if (this.#pj.scripts?.start) {
      return [this.packager, 'run', 'start']
    } else if (this.#pj.type === 'module' && this.#pj.module) {
      return [this.packager === 'bun' ? 'bun' : 'node', this.#pj.module]
    } else if (this.#pj.main) {
      return [this.packager === 'bun' ? 'bun' : 'node', this.#pj.main]
    } else if (this.svelte) {
      return [this.bun ? 'bun' : 'node', './build/index.js']
    } else if (this.packager === 'bun') {
      return ['bun', 'index.ts']
    } else {
      return ['node', 'index.js']
    }
  }

  // Entrypoint script
  get entrypoint() {
    if (this.options.entrypoint) return JSON.stringify(this.options.entrypoint)

    if (!((this.prisma && this.sqlite3) ||
      (this.options.swap && !this.flySetup()) ||
      this.adonisjs)) return null

    const entrypoint = [`/app/${this.configDir}docker-entrypoint.js`]
    if (this.litefs) entrypoint.unshift('litefs', 'mount', '--')

    return JSON.stringify(entrypoint, null, 1).replace(/\n\s*/g, ' ')
  }

  // determine if the entrypoint needs to be adjusted to run on Linux
  // generally only needed when developing on windows
  get entrypointFixups() {
    const fixups = []

    const entrypoint = path.join(this._appdir, 'docker-entrypoint.js')

    const stat = fs.statSync(entrypoint, { throwIfNoEntry: false })
    if (!stat) return fixups

    if (this.options.windows || !(stat.mode & fs.constants.S_IXUSR)) {
      fixups.push('chmod +x ./docker-entrypoint.js')
    }

    if (this.options.windows || fs.readFileSync(entrypoint, 'utf-8').includes('\r')) {
      fixups.push('sed -i "s/\\r$//g" ./docker-entrypoint.js')
    }

    return fixups
  }

  // Tabs vs spaces
  get usingTabs() {
    // disable for now as remix isn't using this generator and it conflicts with eslint
    return false // this.remix
  }

  // ESM vs CJS
  get typeModule() {
    return this.#pj.type === 'module'
  }

  // Port to be used
  get port() {
    if (this.options.port) return this.options.port

    let port = 3000

    if (this.gatsby) port = 8080
    if (this.runtime === 'Vite' || this.astroStatic) port = 80
    if (this.astroSSR) port = 4321

    return port
  }

  get configDir() {
    if (this.remix && fs.existsSync('./other')) {
      return 'other/'
    } else {
      return ''
    }
  }

  // render each template and write to the destination dir
  async run(appdir, options = {}) {
    this.options = options
    this._appdir = appdir
    this.#pj = JSON.parse(fs.readFileSync(path.join(appdir, 'package.json'), 'utf-8'))

    // backwards compatibility with previous definition of --build=defer
    if (options.build === 'defer') {
      options.deferBuild = true
      options.build = ''
    }

    // install modules needed to run
    this.installModules()

    if (options.force) this.#answer = 'a'

    // read instructions
    for (const stage of ['base', 'build', 'deploy']) {
      if (options.instructions?.[stage]) {
        try {
          options.instructions[stage] = fs.readFileSync(
            path.join(this._appdir, options.instructions[stage]),
            'utf-8'
          ).trimEnd()
        } catch (error) {
          console.error(error)
          options.instructions[stage] = ''
        }
      }
    }

    // select and render templates
    const templates = {
      'Dockerfile.ejs': 'Dockerfile'
    }

    if (this.entrypoint) {
      templates['docker-entrypoint.ejs'] = `${this.configDir}docker-entrypoint.js`
    }

    if (this.litefs) {
      templates['litefs.yml.ejs'] = `${this.configDir}litefs.yml`
    }

    if (this.options.nginxRoot) {
      this.options.nginxRoot = path.join('/app', this.options.nginxRoot)
    }

    for (const [template, filename] of Object.entries(templates)) {
      const dest = await this.#writeTemplateFile(template, filename)

      if (template === 'docker-entrypoint.ejs') fs.chmodSync(dest, 0o755)
    }

    // ensure that there is a dockerignore file
    if (!fs.existsSync(path.join(appdir, '.dockerignore'))) {
      try {
        fs.copyFileSync(
          path.join(appdir, '.gitignore'),
          path.join(appdir, '.dockerignore')
        )
      } catch {
        await this.#writeTemplateFile('.dockerignore.ejs', '.dockerignore')
      }
    }

    // run mixin runners
    for (const runner of GDF.runners) {
      runner.apply(this)
    }
  }

  // write template file, prompting when there is a conflict
  async #writeTemplateFile(template, name) {
    const proposed = await ejs.renderFile(path.join(GDF.templates, template), this)
    const dest = path.join(this._appdir, name)

    if (fs.existsSync(dest)) {
      const current = fs.readFileSync(dest, 'utf-8')

      if (current === proposed) {
        console.log(`${chalk.bold.blue('identical'.padStart(11))}  ${name}`)
        return dest
      }

      let prompt
      let question

      try {
        if (this.#answer !== 'a') {
          console.log(`${chalk.bold.red('conflict'.padStart(11))}  ${name}`)

          if (typeof Bun === 'undefined') {
            prompt = readline.createInterface({
              input: process.stdin,
              output: process.stdout
            })

            // support node 16 which doesn't have a promisfied readline interface
            question = query => {
              return new Promise(resolve => {
                prompt.question(query, resolve)
              })
            }
          } else {
            question = query => global.prompt(query) || ''
          }
        }

        while (true) {
          if (question) {
            this.#answer = await question(`Overwrite ${dest}? (enter "h" for help) [Ynaqdh] `)
          }

          switch (this.#answer.toLocaleLowerCase()) {
            case '':
            case 'y':
            case 'a':
              console.log(`${chalk.bold.yellow('force'.padStart(11, ' '))}  ${name}`)
              fs.writeFileSync(dest, proposed)
              return dest

            case 'n':
              console.log(`${chalk.bold.yellow('skip'.padStart(11, ' '))}  ${name}`)
              return dest

            case 'q':
              process.exit(0)
              break

            case 'd':
              console.log(Diff.createPatch(name, current, proposed, 'current', 'proposed').trimEnd() + '\n')
              break

            default:
              console.log('        Y - yes, overwrite')
              console.log('        n - no, do not overwrite')
              console.log('        a - all, overwrite this and all others')
              console.log('        q - quit, abort')
              console.log('        d - diff, show the differences between the old and the new')
              console.log('        h - help, show this help')
          }
        }
      } finally {
        if (prompt && typeof Bun === 'undefined') prompt.close()
      }
    } else {
      console.log(`${chalk.bold.green('create'.padStart(11, ' '))}  ${name}`)
      fs.writeFileSync(dest, proposed)
    }

    return dest
  }
}
