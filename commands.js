import fs from 'node:fs'
import { GDF } from './gdf.js'
import chalk from 'chalk'

// defaults for all the flags that will be saved
export const defaults = {
  distroless: false,
  ignoreScripts: false,
  legacyPeerDeps: false,
  link: true,
  swap: '',
  windows: false
}

export function generateDockerFiles(args) {
  // read previous values from package.json
  let pj = null
  try {
    pj = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
  } catch {}
  // parse and update package.json for default options
  let save = false
  if (pj) {
    pj.dockerfile ||= {}

    for (const prop in defaults) {
      if (prop in args && args[prop] !== pj.dockerfile[prop]) {
        if (args[prop] === defaults[prop]) {
          delete pj.dockerfile[prop]
        } else {
          pj.dockerfile[prop] = args[prop]
        }
        save = true
      }
    }

    Object.assign(defaults, pj.dockerfile)

    if (save) {
      if (Object.keys(pj.dockerfile).length === 0) delete pj.dockerfile
      try {
        fs.writeFileSync('package.json', JSON.stringify(pj, null, 2), 'utf-8')
      } catch (e) {
        console.log(`${chalk.bold.yellow('[WARNING]')} ${chalk.white(e.message)}`)
      }
    }
  }

  // generate dockerfile and related artifacts
  new GDF().run(process.cwd(), { ...defaults, ...args })
}
