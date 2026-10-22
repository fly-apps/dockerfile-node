import path from 'node:path'
import url from 'node:url'
import { execFileSync } from 'node:child_process'

import { expect } from 'chai'

import { useSandbox } from './helpers.js'

const cli = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'index.js')

describe('cli', function() {
  const sandbox = useSandbox()

  // run the cli in the sandbox, returning stdout
  function dockerfile(...args) {
    return execFileSync(process.execPath, [cli, ...args], {
      cwd: sandbox().appdir,
      env: { ...process.env, NODE_ENV: 'test' },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }

  const saved = () => JSON.parse(sandbox().read('package.json')).dockerfile

  beforeEach(function() {
    sandbox().write('package.json', { name: 'app', scripts: { start: 'node index.js' } })
  })

  it('prints usage with --help', function() {
    const out = dockerfile('--help')
    expect(out).to.include('--alpine')
    expect(out).to.include('Options are saved between runs into package.json')
  })

  it('generates a Dockerfile without touching package.json', function() {
    const before = sandbox().read('package.json')
    const out = dockerfile()
    expect(out).to.match(/create\s+Dockerfile/)
    expect(sandbox().read('Dockerfile')).to.include('CMD [ "npm", "run", "start" ]')
    expect(sandbox().read('package.json')).to.equal(before)
  })

  it('saves boolean flags and reuses them on the next run', function() {
    dockerfile('--alpine', '--link')
    expect(saved()).to.deep.equal({ alpine: true, link: true })

    dockerfile('--force')
    expect(sandbox().read('Dockerfile')).to.include('-alpine AS base')
    expect(sandbox().read('Dockerfile')).to.include('COPY --link')
  })

  it('removes a flag when it is reset to its default', function() {
    dockerfile('--alpine')
    dockerfile('--no-alpine', '--force')
    expect(saved()).to.equal(undefined)
    expect(sandbox().read('Dockerfile')).to.include('-slim AS base')
  })

  it('saves string and numeric flags', function() {
    dockerfile('--port', '8080', '--cmd', 'node server.js', '--swap', '1G')
    expect(saved()).to.deep.equal({ port: 8080, cmd: 'node server.js', swap: '1G' })
    expect(sandbox().read('Dockerfile')).to.include('EXPOSE 8080')
  })

  it('saves dashed flags under their camelCase names', function() {
    dockerfile('--legacy-peer-deps', '--ignore-scripts')
    expect(saved()).to.deep.equal({ legacyPeerDeps: true, ignoreScripts: true })
    expect(sandbox().read('Dockerfile')).to.include('npm install --legacy-peer-deps --ignore-scripts')
  })

  it('adds and removes packages per stage', function() {
    dockerfile('--add', 'curl', 'vim', '--add-build', 'libvips-dev', '--add-base', 'tini')
    expect(saved().packages).to.deep.equal({ base: ['tini'], build: ['libvips-dev'], deploy: ['curl', 'vim'] })
    expect(sandbox().read('Dockerfile')).to.include('apt-get install --no-install-recommends -y curl vim')

    dockerfile('--add', 'curl', '--force')
    expect(saved().packages.deploy).to.deep.equal(['curl', 'vim'])

    dockerfile('--remove', 'curl', 'vim', '--remove-base', 'tini', '--remove-build', 'libvips-dev', '--force')
    expect(saved()).to.equal(undefined)
  })

  it('sets, changes and clears environment variables', function() {
    dockerfile('--env', 'FOO:bar', '--env-build', 'BUILD:1')
    expect(saved().envs).to.deep.equal({ deploy: { FOO: 'bar' }, build: { BUILD: '1' } })
    expect(sandbox().read('Dockerfile')).to.include('ENV FOO="bar"')

    dockerfile('--env', 'FOO:baz', '--force')
    expect(saved().envs.deploy).to.deep.equal({ FOO: 'baz' })

    dockerfile('--env', 'FOO', '--env-build', 'BUILD:', '--force')
    expect(saved()).to.equal(undefined)
    expect(sandbox().read('Dockerfile')).not.to.include('FOO')
  })

  it('keeps colons in environment values', function() {
    dockerfile('--env', 'URL:http://example.com:80')
    expect(saved().envs.deploy).to.deep.equal({ URL: 'http://example.com:80' })
  })

  it('writes build arguments into the Dockerfile', function() {
    dockerfile('--arg-build', 'VERSION:1.2.3')
    expect(sandbox().read('Dockerfile')).to.include('ARG VERSION="1.2.3"')
  })

  it('saves build arguments', function() {
    dockerfile('--arg-build', 'VERSION:1.2.3', '--env-build', 'MODE:fast')
    expect(saved().args).to.deep.equal({ build: { VERSION: '1.2.3' } })
    expect(saved().envs).to.deep.equal({ build: { MODE: 'fast' } })
  })

  it('saves instruction files and inlines them', function() {
    sandbox().write('extra.dockerfile', 'RUN echo hello')
    dockerfile('--instructions-build', 'extra.dockerfile')
    expect(saved().instructions).to.deep.equal({ build: 'extra.dockerfile' })
    expect(sandbox().read('Dockerfile')).to.include('RUN echo hello')

    dockerfile('--instructions-build', '', '--force')
    expect(saved()).to.equal(undefined)
  })

  // BUG: --instructions-deploy is aliased to --instructions, which collides
  // with the `instructions` key in defaults; the generic flag loop saves the
  // file name as dockerfile.instructions and then crashes assigning into it.
  // Fixed by #155; unskip once it lands.
  it.skip('saves deploy instructions', function() {
    sandbox().write('extra.dockerfile', 'RUN echo hello')
    dockerfile('--instructions', 'extra.dockerfile')
    expect(saved().instructions).to.deep.equal({ deploy: 'extra.dockerfile' })
  })

  it('mounts and unmounts build secrets', function() {
    sandbox().write('package.json', { name: 'app', scripts: { start: 'node index.js', build: 'make' } })

    dockerfile('--mount-secret', 'API_KEY', 'TOKEN')
    expect(saved().secrets).to.deep.equal(['API_KEY', 'TOKEN'])
    expect(sandbox().read('Dockerfile')).to.include('--mount=type=secret,id=API_KEY')

    dockerfile('--unmount-secret', 'API_KEY', '--force')
    expect(saved().secrets).to.deep.equal(['TOKEN'])

    dockerfile('--unmount-secret', 'TOKEN', '--force')
    expect(saved()).to.equal(undefined)
  })

  it('--skip keeps an existing Dockerfile', function() {
    sandbox().write('Dockerfile', 'FROM scratch\n')
    const out = dockerfile('--skip')
    expect(out).to.match(/skip\s+Dockerfile/)
    expect(sandbox().read('Dockerfile')).to.equal('FROM scratch\n')
  })

  it('--force overrides --skip', function() {
    sandbox().write('Dockerfile', 'FROM scratch\n')
    dockerfile('--skip', '--force')
    expect(sandbox().read('Dockerfile')).to.include('# syntax = docker/dockerfile:1')
  })

  it('preserves unrelated package.json content', function() {
    sandbox().write('package.json', { name: 'app', version: '1.0.0', dockerfile: { other: 'kept' } })
    dockerfile('--alpine')
    const pj = JSON.parse(sandbox().read('package.json'))
    expect(pj.name).to.equal('app')
    expect(pj.version).to.equal('1.0.0')
    expect(pj.dockerfile).to.deep.equal({ other: 'kept', alpine: true })
  })
})
