import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

import { GDF } from './gdf.js'

// Fly.io mixin
GDF.extend(class extends GDF {
  run() {
    const flyToml = path.join(this._appdir, 'fly.toml')

    // ensure fly.toml exists
    if (!fs.existsSync(flyToml)) return

    // create volume for sqlite3
    if (this.sqlite3) this.fly_make_volume(flyToml)
  }

  // add volume to fly.toml and create it if app exists
  fly_make_volume(flyToml) {
    let toml = fs.readFileSync(flyToml, 'utf-8')

    // add a [mounts] section if one is not already present
    if (!toml.includes('[mounts]')) {
      toml += '\n[mounts]\n  source = "data"\n  destination="/data"\n'
      fs.writeFileSync(flyToml, toml)
    }

    // parse app name from fly.toml, bailing if not found
    const app = toml.match(/^app\s*=\s*"?([-\w]+)"?/m)?.[1]
    if (!app) return

    // parse list of existing machines.  This may fail if there are none.
    let machines = []
    try {
      machines = JSON.parse(
        execSync(`flyctl machines list --app ${app} --json`, { encoding: 'utf8' }))
    } catch { }

    // parse list of existing volumes
    const volumes = JSON.parse(
      execSync(`flyctl volumes list --app ${app} --json`, { encoding: 'utf8' }))

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
          `flyctl volumes create data --app ${app} --region ${region}`,
          { stdio: 'inherit' }
        )
      }
    }
  }
})
