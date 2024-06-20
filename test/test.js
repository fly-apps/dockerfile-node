import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

import { expect } from 'chai'

import { GDF, defaults } from '../gdf.js'
import '../fly.js'

for (const group of fs.readdirSync('test', { withFileTypes: true })) {
  if (!group.isDirectory()) continue

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
