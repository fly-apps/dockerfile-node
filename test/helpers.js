import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

import { GDF, defaults } from '../gdf.js'
import '../fly.js'

// keeps installModules from running npm/yarn/pnpm against scratch apps
process.env.NODE_ENV = 'test'

// fresh copy of the default options, so tests never share nested state
export function options(overrides = {}) {
  return { ...structuredClone(defaults), force: true, ...overrides }
}

// A scratch app directory plus a bin directory of stub executables.  PATH is
// restricted to the stubs (plus node itself and the system basics) so that
// whatever happens to be installed on the developer's machine (bun, yarn,
// pnpm, flyctl, shopify) never leaks into the results.
export class Sandbox {
  constructor() {
    this.appdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdf-app-'))
    this.bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdf-bin-'))
    this.log = path.join(this.bindir, 'log')
    fs.writeFileSync(this.log, '')

    this.savedPath = process.env.PATH
    this.savedCwd = process.cwd()
    this.savedExit = process.exit

    // expose node alone, not whatever else lives in its bin directory
    fs.symlinkSync(process.execPath, path.join(this.bindir, 'node'))
    process.env.PATH = [this.bindir, '/usr/bin', '/bin'].join(path.delimiter)
    process.chdir(this.appdir)

    this.exitCode = null
    process.exit = code => { this.exitCode = code }

    // keep generator chatter out of the test report, but keep it inspectable
    this.output = []
    this.savedLog = console.log
    this.savedError = console.error
    console.log = console.error = (...args) => this.output.push(args.join(' '))
  }

  restore() {
    process.chdir(this.savedCwd)
    process.env.PATH = this.savedPath
    process.exit = this.savedExit
    console.log = this.savedLog
    console.error = this.savedError
    fs.rmSync(this.appdir, { recursive: true, force: true })
    fs.rmSync(this.bindir, { recursive: true, force: true })
  }

  // write a file (objects are written as JSON) relative to the app directory
  write(name, content = '') {
    const file = path.join(this.appdir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (typeof content !== 'string') content = JSON.stringify(content, null, 2)
    fs.writeFileSync(file, content)
    return file
  }

  read(name) {
    return fs.readFileSync(path.join(this.appdir, name), 'utf-8')
  }

  exists(name) {
    return fs.existsSync(path.join(this.appdir, name))
  }

  // write an executable stub that logs its arguments then runs script
  stub(name, script = '') {
    const file = path.join(this.bindir, name)
    fs.writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${this.log}"\n${script}`)
    fs.chmodSync(file, 0o755)
  }

  // a flyctl stub that answers list commands with the given JSON
  flyctl({ secrets = [], machines = [], volumes = [], apps = [] } = {}) {
    const json = value => `'${JSON.stringify(value)}'`
    this.stub('flyctl', [
      'case "$*" in',
      `  "secrets list"*) echo ${json(secrets.map(Name => ({ Name })))};;`,
      `  "machines list"*) echo ${json(machines)};;`,
      `  "volumes list"*) echo ${json(volumes)};;`,
      `  "apps list"*) echo ${json(apps)};;`,
      'esac',
      ''
    ].join('\n'))
  }

  calls() {
    return fs.readFileSync(this.log, 'utf-8').split('\n').filter(Boolean)
  }

  async run(pj, opts = {}) {
    if (pj) this.write('package.json', pj)
    const gdf = new GDF()
    await gdf.run(this.appdir, options(opts))
    return gdf
  }
}

// mocha hook helper: provides a fresh sandbox to each test
export function useSandbox() {
  const ref = {}

  beforeEach(function() {
    ref.sandbox = new Sandbox()
  })

  afterEach(function() {
    ref.sandbox.restore()
  })

  return () => ref.sandbox
}
