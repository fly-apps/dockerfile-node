import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

import chalk from 'chalk'

import { GDF } from './gdf.js'

// Fly.io mixin
GDF.extend(class extends GDF {
  run() {
    if (!this.flySetup()) return

    // create volume for sqlite3
    if (this.sqlite3) this.flyMakeVolume()

    // setup swap
    if (this.options.swap != null) this.flySetSwap()

    // attach consul for litefs
    if (this.litefs) this.flyAttachConsul(this.flyApp)

    // set secrets, healthcheck for remix apps
    if (this.remix) {
      this.flyRemixSecrets(this.flyApp)
      this.flyHealthCheck('/healthcheck')
      if (this.postgres) this.flyRelease(`${this.npx} prisma migrate deploy`)
    }

    // set secrets for AdonisJS apps
    if (this.adonisjs) this.flyAdonisJsSecrets(this.flyApp)

    // set up for deploy
    if (fs.existsSync('.github/workflows/deploy.yml')) {
      this.flyGitHubPrep()
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
    this.flyApp = this.flyToml.match(/^app\s*=\s*"?([-\w]+)"?/m)?.[1]

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
      this.flyToml += '\n[mounts]\n  source = "data"\n  destination="/data"\n'
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

    this.flyToml += `\n[deploy]\n  release_command = ${JSON.stringify(command)}`

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
