import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

import chalk from 'chalk'

import { GDF } from './gdf.js'

// Fly.io mixin
GDF.extend(class extends GDF {
  run() {
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

    // create volume for sqlite3
    if (this.sqlite3) this.flyMakeVolume()

    // attach consul for litefs
    if (this.litefs) this.flyAttachConsul()
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
  flyAttachConsul() {
    if (!this.flyApp) return

    // Check fly.toml to guess if v1 or v2
    if (this.flyToml.includes('enable_consul')) return // v1-ism
    if (!this.flyToml.includes('primary_region')) return // v2

    // see if secret is already set?
    try {
      const secrets = JSON.parse(
        execSync(`${this.flyctl} secrets list --json`, { encoding: 'utf8' }))
      if (secrets.some(secret => secret.Name === 'FLY_CONSUL_URL')) return
    } catch {
      return // likely got an error like "Could not find App"
    }

    console.log(`${chalk.bold.green('execute'.padStart(11))}  flyctl consul attach`)
    execSync(
      `${this.flyctl} consul attach --app ${this.flyApp}`,
      { stdio: 'inherit' }
    )
  }
})
