import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

import { expect } from 'chai'

import { GDF, defaults } from '../gdf.js'
import '../fly.js'
import { execSync } from 'node:child_process'

// bun projects are only detected as such when `bun --version` works; the
// version itself is masked below, so a stub will do when bun isn't installed
try {
  execSync('bun --version', { stdio: 'ignore' })
} catch {
  const bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-stub-'))
  fs.writeFileSync(path.join(bindir, 'bun'), '#!/bin/sh\necho 1.2.0\n', { mode: 0o755 })
  process.env.PATH = [bindir, process.env.PATH].join(path.delimiter)
}

for (const group of fs.readdirSync('test', { withFileTypes: true })) {
  if (!group.isDirectory()) continue

  process.env.NODE_ENV = 'test'

  for (const entry of fs.readdirSync(path.join('test', group.name), { withFileTypes: true })) {
    if (!fs.existsSync(path.join('test', group.name, entry.name, 'package.json'))) continue

    describe(`${group.name}: ${entry.name}`, function() {
      const workdir = path.join(os.tmpdir(), group.name, entry.name)
      const testdir = path.join('test', group.name, entry.name)

      if (fs.existsSync(workdir)) fs.rmSync(workdir, { recursive: true })

      fs.cpSync(testdir, workdir, { recursive: true })

      const pj = fs.readFileSync(path.join(testdir, 'package.json'), 'utf-8')
      const options = { ...defaults, ...(JSON.parse(pj).dockerfile || {}) }
      if (options.envs) options.vars = options.envs
      options.force = true

      it('should produce a dockerfile', async function() {
        await new GDF().run(workdir, options)

        let argmask = /^(ARG\s+\w+\s*=).*?(\s*\\?)$/gm
        if (entry.name === 'version') argmask = /()xxx()/g

        const actualResults = fs.readFileSync(path.join(workdir, 'Dockerfile'), 'utf-8')
          .replaceAll(argmask, '$1xxx$2')

        if (process.env.TEST_CAPTURE) {
          fs.writeFileSync(path.join(testdir, 'Dockerfile'), actualResults)
        }

        const expectedResults = fs.readFileSync(path.join(testdir, 'Dockerfile'), 'utf-8')
          .replaceAll(argmask, '$1xxx$2')

        expect(expectedResults).to.equal(actualResults)
      })

      it('should produce a .dockerignore', async function() {
        await new GDF().run(workdir, options)

        const actualResults = fs.readFileSync(path.join(workdir, '.dockerignore'), 'utf-8')

        if (process.env.TEST_CAPTURE) {
          fs.writeFileSync(path.join(testdir, '.dockerignore'), actualResults)
        }

        const expectedResults = fs.readFileSync(path.join(testdir, '.dockerignore'), 'utf-8')

        expect(expectedResults).to.equal(actualResults)
      })

      if (fs.existsSync(path.join(testdir, 'docker-entrypoint.js'))) {
        it('should produce a docker-entrypoint', async function() {
          await new GDF().run(workdir, options)

          let entrypoint = path.join(workdir, 'docker-entrypoint.js')
          const other = path.join(workdir, 'other', 'docker-entrypoint.js')
          if (fs.existsSync(other)) entrypoint = other

          const actualResults = fs.readFileSync(entrypoint, 'utf-8')

          if (process.env.TEST_CAPTURE) {
            fs.writeFileSync(path.join(testdir, 'docker-entrypoint.js'), actualResults)
          }

          const expectedResults = fs.readFileSync(path.join(testdir, 'docker-entrypoint.js'), 'utf-8')

          expect(expectedResults).to.equal(actualResults)
        })
      }

      if (fs.existsSync(path.join(testdir, 'litefs.yml'))) {
        it('should produce a litefs.yml', async function() {
          await new GDF().run(workdir, options)

          const actualResults = fs.readFileSync(path.join(workdir, 'litefs.yml'), 'utf-8')

          if (process.env.TEST_CAPTURE) {
            fs.writeFileSync(path.join(testdir, 'litefs.yml'), actualResults)
          }

          const expectedResults = fs.readFileSync(path.join(testdir, 'litefs.yml'), 'utf-8')

          expect(expectedResults).to.equal(actualResults)
        })
      }

      if (fs.existsSync(path.join(testdir, 'litestream.yml'))) {
        it('should produce a litestream.yml', async function() {
          await new GDF().run(workdir, options)

          const actualResults = fs.readFileSync(path.join(workdir, 'litestream.yml'), 'utf-8')

          if (process.env.TEST_CAPTURE) {
            fs.writeFileSync(path.join(testdir, 'litestream.yml'), actualResults)
          }

          const expectedResults = fs.readFileSync(path.join(testdir, 'litestream.yml'), 'utf-8')

          expect(expectedResults).to.equal(actualResults)
        })
      }

      if (fs.existsSync(path.join(testdir, 'fly.toml'))) {
        it('should produce a fly.toml', async function() {
          let expectedResults = fs.readFileSync(path.join(testdir, 'fly.toml'), 'utf-8')
          fs.writeFileSync(path.join(workdir, 'fly.toml'), '')

          await new GDF().run(workdir, options)

          const actualResults = fs.readFileSync(path.join(workdir, 'fly.toml'), 'utf-8')

          if (process.env.TEST_CAPTURE) {
            fs.writeFileSync(path.join(testdir, 'fly.toml'), actualResults)
            expectedResults = actualResults
          }

          expect(expectedResults).to.equal(actualResults)
        })
      }
    })
  }
}

describe('fly: shopify', function() {
  const savedPath = process.env.PATH
  const savedCwd = process.cwd()
  let workdir, bindir, log

  // write an executable stub that logs its arguments
  function stub(name, script = '') {
    const file = path.join(bindir, name)
    fs.writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${log}"\n${script}`)
    fs.chmodSync(file, 0o755)
  }

  beforeEach(function() {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopify-'))
    bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopify-bin-'))
    log = path.join(bindir, 'log')
    fs.writeFileSync(log, '')

    fs.writeFileSync(path.join(workdir, 'package.json'), JSON.stringify({ name: 'shopify-app', scripts: { start: 'node index.js' } }))
    fs.writeFileSync(path.join(workdir, 'fly.toml'), 'app = "shopify-test"\n')
    fs.writeFileSync(path.join(workdir, 'shopify.app.toml'), [
      'client_id = "abc123"',
      'application_url = "https://example.trycloudflare.com"',
      '',
      '[auth]',
      'redirect_urls = ["https://example.trycloudflare.com/auth/callback"]',
      ''
    ].join('\n'))

    stub('flyctl', 'case "$*" in *" list "*) echo "[]";; esac\n')

    // fly.js looks for shopify.app*.toml in the current directory
    process.chdir(workdir)
    process.env.PATH = [bindir, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter)
  })

  afterEach(function() {
    process.chdir(savedCwd)
    process.env.PATH = savedPath
    fs.rmSync(workdir, { recursive: true })
    fs.rmSync(bindir, { recursive: true })
  })

  it('deploys with --allow-updates', async function() {
    // Shopify CLI 4.x rejects --force
    stub('shopify', 'case "$*" in *--help*) echo "--allow-updates";; *--force*) exit 2;; esac\n')

    await new GDF().run(workdir, { ...defaults, force: true })

    const calls = fs.readFileSync(log, 'utf-8')
    expect(calls).to.include('shopify app env show --config shopify.app.toml')
    expect(calls).to.include('shopify app deploy --allow-updates --config shopify.app.toml')
    expect(calls).not.to.include('--force')

    const config = fs.readFileSync(path.join(workdir, 'shopify.app.toml'), 'utf-8')
    expect(config).to.include('application_url = "https://shopify-test.fly.dev"')
    expect(config).to.include('"https://shopify-test.fly.dev/auth/callback"')
  })

  it('deploys with --force on Shopify CLI before 3.90', async function() {
    stub('shopify', 'case "$*" in *--help*) echo "--force";; *--allow-updates*) exit 2;; esac\n')

    await new GDF().run(workdir, { ...defaults, force: true })

    const calls = fs.readFileSync(log, 'utf-8')
    expect(calls).to.include('shopify app deploy --force --config shopify.app.toml')
    expect(calls).not.to.include('deploy --allow-updates')
  })

  it('continues when shopify app deploy fails', async function() {
    stub('shopify', 'exit 1\n')

    await new GDF().run(workdir, { ...defaults, force: true })

    const config = fs.readFileSync(path.join(workdir, 'shopify.app.toml'), 'utf-8')
    expect(config).to.include('application_url = "https://shopify-test.fly.dev"')
    expect(fs.existsSync(path.join(workdir, 'Dockerfile'))).to.equal(true)
  })

  it('continues when the shopify CLI is not installed', async function() {
    await new GDF().run(workdir, { ...defaults, force: true })

    const config = fs.readFileSync(path.join(workdir, 'shopify.app.toml'), 'utf-8')
    expect(config).to.include('application_url = "https://shopify-test.fly.dev"')
  })
})
