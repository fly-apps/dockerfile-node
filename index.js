#!/usr/bin/env node

import fs from 'node:fs'
import process from 'node:process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { GDF, defaults } from './gdf.js'
import './fly.js'

// read previous values from package.json
let pj = null
try {
  pj = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
} catch {
}

// parse command line for options
const options = yargs((hideBin(process.argv)))
  .usage('$0 [args]')
  .epilog('Options are saved between runs into package.json. more info:\n https://github.com/fly-apps/dockerfile-node#readme')
  .option('distroless', {
    describe: 'use base image from gcr.io/distroless',
    type: 'boolean'
  })
  .option('force', {
    describe: 'force overwrite of existing files',
    type: 'boolean'
  })
  .option('ignore-scripts', {
    alias: 'i',
    describe: 'ignore scripts',
    type: 'boolean'
  })
  .option('legacy-peer-deps', {
    describe: 'ignore peer dependencies',
    type: 'boolean'
  })
  .option('litefs', {
    describe: 'configure and enable litefs',
    type: 'boolean'
  })
  .option('link', {
    describe: 'use COPY --link whenever possible',
    type: 'boolean'
  })
  .option('port', {
    describe: 'expose port',
    type: 'integer'
  })
  .option('swap', {
    alias: 's',
    describe: 'allocate swap space (eg. 1G, 1GiB, 1024M)',
    type: 'string'
  })
  .option('windows', {
    alias: 'w',
    describe: 'make Dockerfile work for Windows users that may have set `git config --global core.autocrlf true`',
    type: 'boolean'
  })
  .parse()

// parse and update package.json for default options
let save = false
if (pj) {
  pj.dockerfile ||= {}

  for (const prop in defaults) {
    if (prop in options && options[prop] !== pj.dockerfile[prop]) {
      if (options[prop] === defaults[prop]) {
        delete pj.dockerfile[prop]
      } else {
        pj.dockerfile[prop] = options[prop]
      }
      save = true
    }
  }

  Object.assign(defaults, pj.dockerfile)

  if (save) {
    if (Object.keys(pj.dockerfile).length === 0) delete pj.dockerfile
    fs.writeFileSync('package.json', JSON.stringify(pj, null, 2), 'utf-8')
  }
}

new GDF().run(process.cwd(), { ...defaults, ...options })
