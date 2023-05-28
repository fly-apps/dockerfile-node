import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

import { expect } from 'chai'

import { GDF } from '../gdf.js'
import { defaults } from '../index.js'

for (const group of fs.readdirSync('test', { withFileTypes: true })) {
  if (!group.isDirectory()) continue

  for (const entry of fs.readdirSync(path.join('test', group.name), { withFileTypes: true })) {
    if (!fs.existsSync(path.join('test', group.name, entry.name, 'package.json'))) continue

    describe(entry.name, function() {
      const workdir = path.join(os.tmpdir(), group.name, entry.name)
      const testdir = path.join('test', group.name, entry.name)

      if (fs.existsSync(workdir)) fs.rmSync(workdir, { recursive: true })

      fs.cpSync(testdir, workdir, { recursive: true })

      const pj = fs.readFileSync(path.join(testdir, 'package.json'), 'utf-8')
      const options = JSON.parse(pj).dockerfile || {}
      options.force = true

      it('should produce a dockerfile', async function() {
        await new GDF().run(workdir, { ...defaults, ...options })

        const actualResults = fs.readFileSync(path.join(workdir, 'Dockerfile'), 'utf-8')
          .replaceAll(/^(ARG\s+\w+\s*=).*?(\s*\\?)$/gm, '$1xxx$2')

        if (process.env.TEST_CAPTURE) {
          fs.writeFileSync(path.join(testdir, 'Dockerfile'), actualResults)
        }

        const expectedResults = fs.readFileSync(path.join(testdir, 'Dockerfile'), 'utf-8')
          .replaceAll(/^(ARG\s+\w+\s*=).*?(\s*\\?)$/gm, '$1xxx$2')

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

      if (pj.includes('prisma')) {
        it('should produce a docker-entrypoint', async function() {
          await new GDF().run(workdir, options)

          const actualResults = fs.readFileSync(path.join(workdir, 'docker-entrypoint'), 'utf-8')

          if (process.env.TEST_CAPTURE) {
            fs.writeFileSync(path.join(testdir, 'docker-entrypoint'), actualResults)
          }

          const expectedResults = fs.readFileSync(path.join(testdir, 'docker-entrypoint'), 'utf-8')

          expect(expectedResults).to.equal(actualResults)
        })
      }
    })
  }
}
