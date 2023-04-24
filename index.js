#!/usr/bin/env node

import process from 'node:process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { GDF } from './gdf.js'

const options = yargs((hideBin(process.argv)))
  .boolean('root')
  .parse()

new GDF().run(process.cwd(), options)
