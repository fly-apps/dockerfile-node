import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

import { expect } from 'chai'

import { GDF } from '../gdf.js'

fs.readdirSync('test', { withFileTypes: true }).forEach(entry => {
  if (!entry.isDirectory()) return
  if (!fs.existsSync(path.join('test', entry.name, 'package.json'))) return

  describe(entry.name, function() {
    const workdir = path.join(os.tmpdir(), entry.name)

    if (fs.existsSync(workdir)) fs.rmSync(workdir, { recursive: true })

    fs.cpSync(path.join('test', entry.name), workdir, { recursive: true })

    it('should produce a dockerfile', async function() {
      await new GDF().run(workdir)

      const actualResults = fs.readFileSync(path.join(workdir, 'Dockerfile'), 'utf-8')
        .replaceAll(/^(ARG\s+\w+\s*=).*?(\s*\\?)$/gm, '$1xxx$2')

      if (process.env.TEST_CAPTURE) {
        fs.writeFileSync(path.join('test', entry.name, 'Dockerfile'), actualResults)
      }

      const expectedResults = fs.readFileSync(path.join('test', entry.name, 'Dockerfile'), 'utf-8')
        .replaceAll(/^(ARG\s+\w+\s*=).*?(\s*\\?)$/gm, '$1xxx$2')

      expect(expectedResults).to.equal(actualResults)
    })

    const pj = fs.readFileSync(path.join('test', entry.name, 'package.json'), 'utf-8')

    it('should produce a .dockerignore', async function() {
      await new GDF().run(workdir)

      const actualResults = fs.readFileSync(path.join(workdir, '.dockerignore'), 'utf-8')

      if (process.env.TEST_CAPTURE) {
        fs.writeFileSync(path.join('test', entry.name, '.dockerignore'), actualResults)
      }

      const expectedResults = fs.readFileSync(path.join('test', entry.name, '.dockerignore'), 'utf-8')

      expect(expectedResults).to.equal(actualResults)
    })

    it('should build docker image successfully', async function() {
      const docker_image_name = `dockerfile-node-test-${entry.name}`
      await new GDF().run(workdir)

      const { execSync } = await import('node:child_process')

      // build the docker image
      execSync(`docker build -t ${docker_image_name} .`, { cwd: workdir, });

      const results = execSync(`docker inspect --type=image ${docker_image_name}`);

      expect(results.toString()).to.not.contain('Error: No such image')
    })

    if (pj.includes('prisma')) {
      it('should produce a docker-entrypoint', async function() {
        await new GDF().run(workdir)

        const actualResults = fs.readFileSync(path.join(workdir, 'docker-entrypoint'), 'utf-8')

        if (process.env.TEST_CAPTURE) {
          fs.writeFileSync(path.join('test', entry.name, 'docker-entrypoint'), actualResults)
        }

        const expectedResults = fs.readFileSync(path.join('test', entry.name, 'docker-entrypoint'), 'utf-8')

        expect(expectedResults).to.equal(actualResults)
      })
    }
  })
})
