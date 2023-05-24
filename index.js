#!/usr/bin/env node
// @ts-check

import process from 'node:process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

// import { GDF } from './gdf.js'
import * as commands from './commands.js'

// parse command line for options
yargs((hideBin(process.argv)))
  .usage('$0 [args]')
  .epilog('Options are saved between runs into package.json. more info:\n https://github.com/fly-apps/dockerfile-node#readme')
  .command('$0', 'generate Dockerfile and related artifacts', yargs => {
    yargs.option('distroless', {
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
      .option('link', {
        describe: 'use COPY --link whenever possible',
        type: 'boolean'
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
  }, commands.generateDockerFiles)
  .parse()
