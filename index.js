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
  .option('alpine', {
    describe: 'use alpine as base image',
    type: 'boolean'
  })
  .option('build', {
    describe: 'if set to "defer" will run build at deploy time',
    type: 'string'
  })
  .option('cmd', {
    describe: 'CMD to be used in the Dockerfile',
    type: 'string'
  })
  .option('cache', {
    describe: 'use build caching to speed up builds',
    type: 'string'
  })
  .option('defer-build', {
    describe: 'if true, run build at deploy time',
    type: 'boolean'
  })
  .option('dev', {
    describe: 'install devDependencies in production',
    type: 'boolean'
  })
  .option('distroless', {
    describe: 'use base image from gcr.io/distroless',
    type: 'boolean'
  })
  .option('entrypoint', {
    describe: 'ENTRYPOINT to be used in the Dockerfile',
    type: 'string'
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
  .option('nginx-root', {
    describe: 'Root directory containing static files to be served by nginx',
    type: 'string'
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

  .option('add-base', {
    describe: 'additional packages to install for both build and deploy',
    type: 'array'
  })
  .option('add-build', {
    describe: 'additional packages to install for use during build',
    type: 'array'
  })
  .option('add-deploy', {
    alias: 'add',
    describe: 'additional packages to install for for deployment',
    type: 'array'
  })
  .option('remove-base', {
    describe: 'remove from list of base packages',
    type: 'array'
  })
  .option('remove-build', {
    describe: 'remove from list of build packages',
    type: 'array'
  })
  .option('remove-deploy', {
    alias: 'remove',
    describe: 'remove from list of deploy packages',
    type: 'array'
  })

  .option('env-base', {
    describe: 'additional environment variables for both build and deploy',
    type: 'array'
  })
  .option('env-build', {
    describe: 'additional environment variables for use during build',
    type: 'array'
  })
  .option('env-deploy', {
    alias: 'env',
    describe: 'additional environment variables to set for deployment',
    type: 'array'
  })

  .option('arg-base', {
    alias: 'arg',
    describe: 'additional build arguments for both build and deploy',
    type: 'array'
  })
  .option('arg-build', {
    describe: 'additional build arguments for use during build',
    type: 'array'
  })
  .option('arg-deploy', {
    describe: 'additional build arguments to set for deployment',
    type: 'array'
  })

  .option('instructions-base', {
    describe: 'additional instructions to add to the base stage',
    type: 'string'
  })
  .option('instructions-build', {
    describe: 'additional instructions to add to the build stage',
    type: 'string'
  })
  .option('instructions-deploy', {
    alias: 'instructions',
    describe: 'additional instructions to add to the deploy stage',
    type: 'string'
  })

  .option('mount-secret', {
    describe: 'list of secrets to mount during the build step',
    type: 'array'
  })
  .option('unmount-secret', {
    describe: 'remove secret from the list to mount during the build step',
    type: 'array'
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

  const df = pj.dockerfile

  options.packages = { ...defaults.packages, ...df.packages }
  options.vars = { ...defaults.vars, ...df.envs }
  options.args = { ...defaults.args, ...df.args }
  options.instructions = { base: null, build: null, deploy: null, ...df.instructions }

  Object.assign(defaults, df)

  df.packages ||= {}
  df.envs ||= {}
  df.args ||= {}
  df.instructions ||= {}
  df.secrets ||= []

  for (const stage of ['base', 'build', 'deploy']) {
    // packages
    for (const pkg of options[`add-${stage}`] || []) {
      if (!options.packages[stage].includes(pkg)) {
        options.packages[stage].push(pkg)
        save = true
      }
    }

    for (const pkg of options[`remove-${stage}`] || []) {
      if (options.packages[stage].includes(pkg)) {
        const index = options.packages[stage].indexOf(pkg)
        options.packages[stage].splice(index, 1)
        save = true
      }
    }

    if (options.packages[stage].length === 0) {
      delete df.packages[stage]
    } else {
      df.packages[stage] = options.packages[stage]
    }

    // environment variables
    for (const env of options[`env-${stage}`] || []) {
      const match = env.match(/^(\w+):?(.*)/)
      const vars = options.vars[stage]
      if (vars[match[1]]) {
        if (match[2] === '') {
          delete vars[match[1]]
          save = true
        } else if (vars[match[1]] !== match[2]) {
          vars[match[1]] = match[2]
          save = true
        }
      } else if (match[2] !== '') {
        vars[match[1]] = match[2]
        save = true
      }
    }

    if (Object.keys(options.vars[stage]).length === 0) {
      delete df.envs[stage]
    } else {
      df.envs[stage] = options.vars[stage]
    }

    // build arguments
    for (const arg of options[`arg-${stage}`] || []) {
      const match = arg.match(/^(\w+):?(.*)/)
      const args = options.args[stage]
      if (args[match[1]]) {
        if (match[2] === '') {
          delete args[match[1]]
          save = true
        } else if (args[match[1]] !== match[2]) {
          args[match[1]] = match[2]
          save = true
        }
      } else if (match[2] !== '') {
        args[match[1]] = match[2]
        save = true
      }
    }

    if (Object.keys(options.args[stage]).length === 0) {
      delete df.args[stage]
    } else {
      df.args[stage] = options.vars[stage]
    }

    // instructions
    const instructions = options[`instructions-${stage}`]
    if (instructions !== undefined) {
      if (options.instructions[stage]) {
        if (instructions === '') {
          delete options.instructions[stage]
          save = true
        } else if (options.instructions[stage] !== instructions) {
          options.instructions[stage] = instructions
          save = true
        }
      } else if (instructions !== '') {
        options.instructions[stage] = instructions
        save = true
      }
    }

    if (options.instructions[stage]) {
      df.instructions[stage] = options.instructions[stage]
    } else {
      delete df.instructions[stage]
    }
  }

  // mount/unmount secrets
  for (const secret of options.mountSecret || []) {
    if (!df.secrets.includes(secret)) {
      save = true
      df.secrets.push(secret)
    }
  }
  for (const secret of options.unmountSecret || []) {
    if (df.secrets.includes(secret)) {
      save = true
      df.secrets = df.secrets.filter(value => value !== secret)
    }
  }
  options.secrets = df.secrets

  // remove empty collections
  if (Object.keys(df.packages).length === 0) delete df.packages
  if (Object.keys(df.envs).length === 0) delete df.envs
  if (Object.keys(df.args).length === 0) delete df.args
  if (Object.keys(df.instructions).length === 0) delete df.instructions
  if (df.secrets.length === 0) delete df.secrets

  if (save) {
    if (Object.keys(pj.dockerfile).length === 0) delete pj.dockerfile
    fs.writeFileSync('package.json', JSON.stringify(pj, null, 2), 'utf-8')
  }
}

new GDF().run(process.cwd(), { ...defaults, ...options })
