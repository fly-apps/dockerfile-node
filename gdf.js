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
  distroless: false,
  ignoreScripts: false,
  legacyPeerDeps: false,
  link: true,
  litefs: false,
  port: 0,
  swap: '',
  windows: false
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

  // Does this application use next.js?
  get nextjs() {
    return !!this.#pj.dependencies?.next
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

  // packages needed for deployment
  get deployPackages() {
    const packages = []

    if (this.litefs) packages.push('ca-certificates', 'fuse3')
    if (this.remix && this.sqlite3) packages.push('sqlite3')
    if (this.prisma) packages.push('openssl')

    return packages.sort()
  }

  // what node version should be used?
  get nodeVersion() {
    const ltsVersion = '18.16.0'

    return process.version.match(/\d+\.\d+\.\d+/)?.[0] || ltsVersion
  }

  // classic version of yarn (installed by default)
  yarnClassic = '1.22.19'

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
    return (version >= 16) && ((version & 1) === 0)
  }

  // List of package files needed to install
  get packageFiles() {
    const result = ['package.json']

    const files = [
      'package-lock.json', '.npmrc',
      'pnpm-lock.yaml',
      'yarn.lock', '.yarnrc'
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

    if (packageFiles.includes('yarn.lock')) {
      this.#packager = 'yarn'
    } else if (packageFiles.includes('pnpm-lock.yaml')) {
      this.#packager = 'pnpm'
    } else {
      this.#packager = 'npm'
    }

    return this.#packager
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

    // optionally include dev dependencies
    if (this.devDependencies) {
      if (this.yarn) {
        install += ' --production=false'
      } else if (this.pnpm) {
        install += ' --prod=false'
      } else {
        install += ' --include=dev'
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

  // How to install python (switched from buster to bullseye)
  get python() {
    return parseInt(this.nodeVersion.split('.')[0]) > 16 ? 'python-is-python3' : 'python'
  }

  // Are there any development dependencies?
  get devDependencies() {
    return !!this.#pj.devDependencies
  }

  // Is there a build script?
  get build() {
    return !!this.#pj.scripts?.build
  }

  // Descriptive form of detected runtime
  get runtime() {
    let runtime = 'Node.js'

    if (this.remix) runtime = 'Remix'
    if (this.nextjs) runtime = 'Next.js'
    if (this.nuxtjs) runtime = 'Nuxt.js'
    if (this.nestjs) runtime = 'NestJS'
    if (this.gatsby) runtime = 'Gatsby'
    if (this.adonisjs) runtime = 'AdonisJS'

    if (this.prisma) runtime += '/Prisma'

    return runtime
  }

  get user() {
    return this.runtime.split('/')[0].replaceAll('.', '').toLowerCase()
  }

  // command to start the web server
  get startCommand() {
    if (this.options.distroless) {
      const start = this.#pj.scripts.start
      const parsed = ShellQuote.parse(start)
      return parsed
    }

    if (this.adonisjs) {
      return ['node', '/app/build/server.js']
    }

    if (this.gatsby) {
      return ['npx', 'gatsby', 'serve', '-H', '0.0.0.0']
    } else if (this.runtime === 'Node.js' && this.#pj.scripts?.start?.includes('fastify')) {
      let start = this.#pj.scripts.start
      if (!start.includes('-a') && !start.includes('--address')) {
        start = start.replace('start', 'start --address 0.0.0.0')
      }

      start = start.split(' ')
      start.unshift('npx')
      return start
    } else {
      return [this.packager, 'run', 'start']
    }
  }

  // Does this Dockerfile need an entrypoint script?
  get entrypoint() {
    return this.prisma || this.options.swap || this.adonisjs
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

    if (options.force) this.#answer = 'a'

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
        if (prompt) prompt.close()
      }
    } else {
      console.log(`${chalk.bold.green('create'.padStart(11, ' '))}  ${name}`)
      fs.writeFileSync(dest, proposed)
    }

    return dest
  }
}
