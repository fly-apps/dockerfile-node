#!/usr/bin/env node

import fs from 'node:fs'
import url from 'node:url'
import path from 'node:path'
import { execSync } from 'node:child_process'

import * as ejs from 'ejs'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// Generate Dockerfile class
export class GDF {
  static templates = path.join(__dirname, 'templates')

  // Where the app is.  Used both for scanning and is updated with new files.
  #appdir

  // Parsed package.json file contents.
  #pj

  // which packager is used (npm, pnpm, yarn)
  #packager

  // Does this application use remix.run?
  get remix () {
    return !!(this.#pj.dependencies.remix ||
      this.#pj.dependencies['@remix-run/node'])
  }

  // Does this application use prisma?
  get prisma () {
    return !!(this.#pj.dependencies['@prisma/client'] ||
      this.#pj.devDependencies?.prisma)
  }

  // Does this application use next.js?
  get nextjs () {
    return !!this.#pj.dependencies.next
  }

  // Does this application use nuxt.js?
  get nuxtjs () {
    return !!this.#pj.dependencies.nuxt
  }

  // Does this application use gatsby?
  get gatsby () {
    return !!this.#pj.dependencies.gatsby
  }

  // Does this application use nest?
  get nestjs () {
    return !!this.#pj.dependencies['@nestjs/core']
  }

  // what node version should be used?
  get nodeVersion () {
    const ltsVersion = '18.16.0'

    try {
      return execSync('node -v', { encoding: 'utf8' })
        .match(/\d+\.\d+\.\d+/)?.[0] || ltsVersion
    } catch {
      return ltsVersion
    }
  }

  // classic version of yarn (installed by default)
  yarnClassic = '1.22.19'

  // What yarn version should be used?
  get yarnVersion () {
    try {
      return execSync('yarn --version', { encoding: 'utf8' })
        .match(/\d+\.\d+\.\d+/)?.[0] || this.yarnClassic
    } catch {
      return this.yarnClassic
    }
  }

  // What pnpm version should be used?
  get pnpmVersion () {
    try {
      return execSync('pnpm --version', { encoding: 'utf8' })
        .match(/\d+\.\d+\.\d+/)?.[0] || 'latest'
    } catch {
      return 'latest'
    }
  }

  // List of package files needed to install
  get packageFiles () {
    const result = ['package.json']

    for (const file of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
      if (fs.statSync(path.join(this.#appdir, file), { throwIfNoEntry: false })) {
        result.push(file)
      }
    }

    return result
  }

  // Which packager should be used?
  get packager () {
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

  // Is the packager yarn?
  get yarn () {
    return this.packager === 'yarn'
  }

  // Is the packager pnpm?
  get pnpm () {
    return this.packager === 'pnpm'
  }

  // How to install python (switched from buster to bullseye)
  get python () {
    return parseInt(this.nodeVersion.split('.')[0]) > 16 ? 'python-is-python3' : 'python'
  }

  // Are there any development dependencies?
  get devDependencies () {
    return !!this.#pj.devDependencies
  }

  // Is there a build script?
  get build () {
    return !!this.#pj.scripts?.build
  }

  // Descriptive form of detected runtime
  get runtime () {
    let runtime = 'Node.js'

    if (this.remix) runtime = 'Remix'
    if (this.nextjs) runtime = 'Next.js'
    if (this.nuxtjs) runtime = 'Nuxt.js'
    if (this.nestjs) runtime = 'NestJS'
    if (this.gatsby) runtime = 'Gatsby'

    if (this.prisma) runtime += '/Prisma'

    return runtime
  }

  get user () {
    return this.runtime.split('/')[0].replaceAll('.', '').toLowerCase()
  }

  // command to start the web server
  get startCommand () {
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

  // determine if the entrypoint needs to be adjusted to run on Linux
  // generally only needed when developing on windows
  get entrypointFixups () {
    const fixups = []

    const entrypoint = path.join(this.#appdir, 'docker-entrypoint')

    const stat = fs.statSync(entrypoint, { throwIfNoEntry: false })
    if (!stat) return fixups

    if (this.options.windows || !(stat.mode & fs.constants.S_IXUSR)) {
      fixups.push('chmod +x ./docker-entrypoint')
    }

    if (this.options.windows || fs.readFileSync(entrypoint, 'utf-8').includes('\r')) {
      fixups.push('sed -i "s/\\r$//g" ./docker-entrypoint')
    }

    return fixups
  }

  // Port to be used
  get port () {
    let port = 3000

    if (this.gatsby) port = 8080
    if (this.remix) port = 8080

    return port
  }

  // render each template and write to the destination dir
  async run (appdir, options = {}) {
    this.options = options
    this.#appdir = appdir
    this.#pj = JSON.parse(fs.readFileSync(path.join(appdir, 'package.json'), 'utf-8'))

    // select and render templates
    const templates = ['Dockerfile.ejs']
    if (this.prisma) templates.unshift('docker-entrypoint.ejs')

    for (const template of templates) {
      const dest = await this.#writeTemplateFile(template)

      if (template === 'docker-entrypoint.ejs') fs.chmodSync(dest, 0o755)
    }

    // ensure that there is a dockerignore file
    try {
      fs.statSync(path.join(appdir, '.dockerignore'))
    } catch {
      try {
        fs.copyFileSync(
          path.join(appdir, '.gitignore'),
          path.join(appdir, '.dockerignore')
        )
      } catch {
        await this.#writeTemplateFile('.dockerignore.ejs')
      }
    }
  }

  async #writeTemplateFile (template) {
    const contents = await ejs.renderFile(path.join(GDF.templates, template), this)
    const dest = path.join(this.#appdir, template.replace(/\.ejs$/m, ''))

    fs.writeFileSync(dest, contents)

    return dest
  }
}
