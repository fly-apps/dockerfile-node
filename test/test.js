import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

import { expect } from 'chai'

import { GDF } from '../gdf.js'

const entries = fs.readdirSync('test', { withFileTypes: true })

describe('dockerfile-node-test', function () {
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!fs.existsSync(path.join('test', entry.name, 'package.json'))) continue

    describe(entry.name, function () {
      const workdir = path.join(os.tmpdir(), entry.name)

      if (fs.existsSync(workdir)) fs.rmSync(workdir, { recursive: true })

      fs.cpSync(path.join('test', entry.name), workdir, { recursive: true })

      const pj = fs.readFileSync(path.join('test', entry.name, 'package.json'), 'utf-8')
      const options =JSON.parse(pj).dockerfile || {}

      it('should produce a dockerfile', async function () {
        await new GDF().run(workdir, options)

        const actualResults = fs.readFileSync(path.join(workdir, 'Dockerfile'), 'utf-8')
          .replaceAll(/^(ARG\s+\w+\s*=).*?(\s*\\?)$/gm, '$1xxx$2')

        if (process.env.TEST_CAPTURE) {
          fs.writeFileSync(path.join('test', entry.name, 'Dockerfile'), actualResults)
        }

        const expectedResults = fs.readFileSync(path.join('test', entry.name, 'Dockerfile'), 'utf-8')
          .replaceAll(/^(ARG\s+\w+\s*=).*?(\s*\\?)$/gm, '$1xxx$2')

        expect(expectedResults).to.equal(actualResults)
      })

      it('should produce a .dockerignore', async function () {
        await new GDF().run(workdir, options)

        const actualResults = fs.readFileSync(path.join(workdir, '.dockerignore'), 'utf-8')

        if (process.env.TEST_CAPTURE) {
          fs.writeFileSync(path.join('test', entry.name, '.dockerignore'), actualResults)
        }

        const expectedResults = fs.readFileSync(path.join('test', entry.name, '.dockerignore'), 'utf-8')

        expect(expectedResults).to.equal(actualResults)
      })

      if (pj.includes('prisma')) {
        it('should produce a docker-entrypoint', async function () {
          await new GDF().run(workdir, options)

          const actualResults = fs.readFileSync(path.join(workdir, 'docker-entrypoint'), 'utf-8')

          if (process.env.TEST_CAPTURE) {
            fs.writeFileSync(path.join('test', entry.name, 'docker-entrypoint'), actualResults)
          }

          const expectedResults = fs.readFileSync(path.join('test', entry.name, 'docker-entrypoint'), 'utf-8')

          expect(expectedResults).to.equal(actualResults)
        })
      }
    })
  }
})
