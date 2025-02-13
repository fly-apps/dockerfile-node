import crypto from 'node:crypto'
import fs from 'node:fs'
import inquirer from 'inquirer'
import path from 'node:path'
import { execSync } from 'node:child_process'

import chalk from 'chalk'

import { GDF } from './gdf.js'

// Fly.io mixin
GDF.extend(class extends GDF {
  async run() {
    if (!this.flySetup()) return

    // create volume for sqlite3
    if (this.sqlite3) this.flyMakeVolume()

    if (this.sqlite3 && this.setupScriptType === 'dbsetup') {
      this.flySetCmd()
    }

    // setup swap
    if (this.options.swap != null) this.flySetSwap()

    // attach consul for litefs
    if (this.litefs) this.flyAttachConsul(this.flyApp)

    // set secrets, healthcheck for remix apps
    if (this.shopify) {
      const shopifyConfig = await this.selectShopifyConfig()
      if (shopifyConfig) {
        this.flyShopifyEnv(this.flyApp, shopifyConfig)
        this.flyShopifyConfig(this.flyApp, shopifyConfig)
      }
    } else if (this.remix) {
      this.flyRemixSecrets(this.flyApp)
      this.flyHealthCheck('/healthcheck')
    }

    if (this.prisma && this.postgres) this.flyRelease(`${this.npx} prisma migrate deploy`)

    // set secrets for AdonisJS apps
    if (this.adonisjs) this.flyAdonisJsSecrets(this.flyApp)

    // set up for deploy
    if (fs.existsSync('.github/workflows/deploy.yml')) {
      this.flyGitHubPrep()
    }

    // prisma: ensure that there is at least one migration present
    if (this.prisma && !fs.existsSync(path.join(this._appdir, 'prisma/migrations'))) {
      if (this.prismaFile && !fs.existsSync(path.join(this._appdir, 'prisma', this.prismaFile)) && fs.existsSync(path.join(this._appdir, 'node_modules'))) {
        execSync(`${this.npx} prisma migrate dev --name init --create-only`, { stdio: 'inherit' })
      } else {
        console.error(chalk.bold.red('\nNo migrations found. Please run `npx prisma migrate dev` to create an initial migration.'))
        this.setExit(42)
      }
    }
  }

  // Verify that fly.toml exists, flyctl is in the path, extract appname
  // and secrets, and save information into this object.
  flySetup() {
    if ('flyctl' in this) return this.flyctl != null

    this.flyTomlFile = path.join(this._appdir, 'fly.toml')

    // ensure fly.toml exists
    if (!fs.existsSync(this.flyTomlFile)) return

    // read fly.toml
    this.flyToml = fs.readFileSync(this.flyTomlFile, 'utf-8')

    // parse app name from fly.toml
    this.flyApp = this.flyToml.match(/^app\s*=\s*["']?([-\w]+)["']?/m)?.[1]

    // see if flyctl is in the path
    const paths = (process.env.PATH || '')
      .replace(/"/g, '')
      .split(path.delimiter)
      .filter(Boolean)

    const exe = 'flyctl'

    const extensions = (process.env.PATHEXT || '').split(';')

    const candidates = function * () {
      for (const dir of paths) {
        for (const ext of extensions) {
          yield path.join(dir, exe + ext)
        }
      }
    }

    this.flyctl = null

    for (const file of candidates()) {
      try {
        fs.accessSync(file, fs.constants.X_OK)
        this.flyctl = file
        break
      } catch {
      }
    }

    if (!this.flyctl) return

    if (this.flyctl.includes(' ')) this.flyctl = JSON.stringify(this.flyctl)

    // get a list of secrets
    if (this.flyApp) {
      try {
        this.flySecrets = JSON.parse(
          execSync(`${this.flyctl} secrets list --json`, { encoding: 'utf8' })
        ).map(secret => secret.Name)
      } catch {
        return // likely got an error like "Could not find App"
      }
    }

    return true
  }

  // add volume to fly.toml and create it if app exists
  flyMakeVolume() {
    // add a [mounts] section if one is not already present
    if (!this.flyToml.includes('[mounts]')) {
      this.flyToml += '\n[mounts]\n  source = "data"\n  destination="/data"\n' +
        '  auto_extend_size_threshold = 80\n' +
        '  auto_extend_size_increment = "1GB"\n' +
        '  auto_extend_size_limit = "10GB"\n'
      fs.writeFileSync(this.flyTomlFile, this.flyToml)
    }

    // bail if there is no app
    if (!this.flyApp) return

    // parse list of existing machines.  This may fail if there are none.
    let machines = []
    try {
      machines = JSON.parse(
        execSync(`${this.flyctl} machines list --app ${this.flyApp} --json`, { encoding: 'utf8' }))
    } catch { }

    // parse list of existing volumes
    const volumes = JSON.parse(
      execSync(`${this.flyctl} volumes list --app ${this.flyApp} --json`, { encoding: 'utf8' }))

    // count the number of volumes needed in each region
    const map = {}
    for (const machine of machines) {
      map[machine.region] ||= 0
      map[machine.region]++
    }

    // subtract the number of volumes that already exist
    for (const volume of volumes) {
      if (map[volume.Region]) map[volume.Region]--
    }

    // allocate volumes
    for (let [region, count] of Object.entries(volumes)) {
      while (count-- > 0) {
        execSync(
          `${this.flyctl} volumes create data --app ${this.flyApp} --region ${region}`,
          { stdio: 'inherit' }
        )
      }
    }
  }

  // override command in fly.toml to include dbsetup.js
  flySetCmd() {
    if (this.flyToml.includes('[processes]')) return

    let cmd = this.startCommand

    const dockerfile = fs.readFileSync('Dockerfile', 'utf8')

    const match = dockerfile.match(/^\s*CMD\s+(\[.*\]|".*")/mi)
    if (match) {
      try {
        cmd = JSON.parse(match[1])
      } catch { }
    }

    if (Array.isArray(cmd)) cmd = cmd.join(' ')
    cmd = `${this.bun ? 'bun' : 'node'} ./dbsetup.js ${cmd}`
    this.flyToml += `\n[processes]\n  app = ${JSON.stringify(cmd)}\n`
    fs.writeFileSync(this.flyTomlFile, this.flyToml)
  }

  // add volume to fly.toml and create it if app exists
  flyAttachConsul(app) {
    if (!app) return

    // bail if v1 app
    if (this.flyToml.includes('enable_consul')) return // v1-ism

    // see if secret is already set?
    if (this.flySecrets.includes('FLY_CONSUL_URL')) return

    console.log(`${chalk.bold.green('execute'.padStart(11))}  flyctl consul attach`)
    execSync(
      `${this.flyctl} consul attach --app ${app}`,
      { stdio: 'inherit' }
    )
  }

  // add volume to fly.toml and create it if app exists
  flySetSwap() {
    let size = 0

    const suffixes = {
      kib: 1024,
      k: 1024,
      kb: 1000,
      mib: 1048576,
      m: 1048576,
      mb: 100000,
      gib: 1073741824,
      g: 1073741824,
      gb: 100000000
    }

    const pattern = new RegExp(`^(\\d+)(${Object.keys(suffixes).join('|')})?$`, 'im')

    const match = this.options.swap.match(pattern)

    if (match) {
      size = Math.round((parseInt(match[1]) * (suffixes[match[2].toLowerCase()] || 1)) / 1048576)
    }

    // add (or replace or remove) swap value
    if (this.flyToml.includes('swap_size_mb')) {
      this.flyToml = this.flyToml.replace(
        /^(swap_size_mb\s*=\s*)(.*)(\n|$)/m,
        size ? `$1${size}\n` : ''
      )
    } else if (size > 0) {
      this.flyToml += `\nswap_size_mb = ${size}\n`
    }

    fs.writeFileSync(this.flyTomlFile, this.flyToml)
  }

  // set various secrets
  flySetSecrets({ app, requiredSecrets, shouldSet = () => true }) {
    let secrets = this.flySecrets

    if (app !== this.flyApp) {
      // get a list of secrets for selected app
      try {
        secrets = JSON.parse(
          execSync(`${this.flyctl} secrets list --app ${app} --json`, { encoding: 'utf8' })
        ).map(secret => secret.Name)
      } catch {
        return // likely got an error like "Could not find App"
      }
    }

    for (const name of requiredSecrets) {
      if (!secrets || secrets.includes(name)) continue
      if (!shouldSet(name)) continue

      const value = crypto.randomBytes(32).toString('hex')

      console.log(`${chalk.bold.green('execute'.padStart(11))}  flyctl secrets set ${name}`)
      execSync(
        `${this.flyctl} secrets set ${name}=${value} --app ${app}`,
        { stdio: 'inherit' }
      )
    }
  }

  // add a deploy/release step
  flyRelease(command) {
    if (this.flyToml.includes('[deploy]')) return

    this.flyToml += `\n[deploy]\n  release_command = ${JSON.stringify(command)}\n`

    if (this.prismaSeed) {
      this.flyToml += `  seed_command = ${JSON.stringify(this.prismaSeed)}\n`
    }

    fs.writeFileSync(this.flyTomlFile, this.flyToml)
  }

  // set healthcheck endpoint
  flyHealthCheck(endpoint) {
    if (this.flyToml.match(/\[\[(http_)?services?.(http_)?checks\]\]/)) return

    this.flyToml += '\n[[http_service.checks]]\n  grace_period = "10s"\n' +
      '  interval = "30s"\n  method = "GET"\n  timeout = "5s"\n' +
      `  path = ${JSON.stringify(endpoint)}\n`

    fs.writeFileSync(this.flyTomlFile, this.flyToml)
  }

  // set various secrets for Remix (and Epic Stack) applications
  flyRemixSecrets(app) {
    this.flySetSecrets({
      app,
      requiredSecrets: ['SESSION_SECRET', 'INTERNAL_COMMAND_TOKEN'],
      shouldSet: (name) => name === 'SESSION_SECRET' || this.epicStack
    })
  }

  // set various secrets for AdonisJS applications
  flyAdonisJsSecrets(app) {
    this.flySetSecrets({
      app,
      requiredSecrets: ['APP_KEY']
    })
  }

  async selectShopifyConfig() {
    // Search for both shopify.app.toml and shopify.app.*.toml
    const files = fs.readdirSync('.')
      .filter(file => file.startsWith('shopify.app.') && file.endsWith('.toml'))
      .sort()

    if (files.length === 0) {
      return null
    }

    if (files.length === 1) {
      return files[0]
    }

    // Multiple files found, prompt user to select one
    const { selectedFile } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedFile',
        message: 'Multiple configuration files found. Please select one:',
        choices: files.map(file => ({
          name: file,
          value: file
        }))
      }
    ])

    return selectedFile
  }

  // set environment and secrets for Shopify apps
  flyShopifyEnv(app, configFile) {
    let toml = ''
    if (fs.existsSync(configFile)) {
      toml = fs.readFileSync(configFile, 'utf-8')
    }

    if (!toml.includes('client_id')) {
      this.setExit(42)
      console.log(`${chalk.bold.red(configFile)} is not complete; run ${chalk.bold.blue('shopify app config create')} first.`)
      return
    }

    const env = {
      PORT: 3000,
      SHOPIFY_APP_URL: `https://${app}.fly.dev`
    }

    try {
      console.log(`${chalk.bold.green('execute'.padStart(11))}  shopify app env show --config ${configFile}`)
      const stdout = execSync('shopify app env show', { encoding: 'utf8' })
      for (const match of stdout.matchAll(/^\s*(\w+)=(.*)/mg)) {
        if (match[1] === 'SHOPIFY_API_SECRET') {
          console.log(`${chalk.bold.green('execute'.padStart(11))}  flyctl secrets set SHOPIFY_API_SECRET`)
          execSync(`${this.flyctl} secrets set SHOPIFY_API_SECRET=${match[2]} --app ${app}`, { stdio: 'inherit' })
        } else {
          env[match[1]] = match[2]
        }
      }
    } catch { }

    if (this.flyToml.includes('[env]')) return
    this.flyToml += '\n[env]\n' + Object.entries(env).map(([key, value]) => `  ${key} = ${JSON.stringify(value)}`).join('\n') + '\n'
    fs.writeFileSync(this.flyTomlFile, this.flyToml)
  }

  // update config for Shopify apps
  flyShopifyConfig(app, configFile) {
    const original = fs.readFileSync(configFile, 'utf-8')
    const url = `https://${app}.fly.dev`
    const config = original.replaceAll(/"https:\/\/[-\w.]+/g, '"' + url)
      .replace(/(redirect_urls\s*=\s*\[).*?\]/s,
        `$1\n  "${url}/auth/callback",\n  "${url}/auth/shopify/callback",\n  "${url}/api/auth/callback"\n]`)
    if (original !== config) {
      console.log(`${chalk.bold.green('update'.padStart(11, ' '))}  ${configFile}`)
      fs.writeFileSync(configFile, config)
      console.log(`${chalk.bold.green('execute'.padStart(11))}  shopify app deploy --force --config ${configFile}`)
      execSync(`shopify app deploy --force --config ${configFile}`, { stdio: 'inherit' })
    }
  }

  // prep for deployment via GitHub actions, including setting up a staging app
  flyGitHubPrep() {
    const deploy = fs.readFileSync('.github/workflows/deploy.yml', 'utf-8')

    if (!fs.existsSync('.git')) {
      console.log(`${chalk.bold.green('execute'.padStart(11))}  git init`)
      execSync('git init', { stdio: 'inherit' })
    }

    if (deploy.includes('🚀 Deploy Staging') && deploy.includes('-staging')) {
      const stagingApp = `${this.flyApp}-staging`

      try {
        const apps = JSON.parse(
          execSync(`${this.flyctl} apps list --json`, { encoding: 'utf8' })
        )

        const base = apps.find(app => app.Name === this.flyApp)

        if (base && !apps.find(app => app.Name === stagingApp)) {
          const cmd = `apps create ${stagingApp} --org ${base.Organization.Slug}`
          console.log(`${chalk.bold.green('execute'.padStart(11))}  flyctl ${cmd}`)
          execSync(`${this.flyctl} ${cmd}`, { stdio: 'inherit' })
        }
      } catch {
        return // likely got an error like "Could not find App"
      }

      // attach consul for litefs
      if (this.litefs) this.flyAttachConsul(stagingApp)

      // set secrets for remix apps
      if (this.remix) this.flyRemixSecrets(stagingApp)
    }
  }
})
