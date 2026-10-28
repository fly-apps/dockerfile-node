import fs from 'node:fs'

import { expect } from 'chai'

import { useSandbox } from './helpers.js'

const currentNode = process.version.match(/\d+\.\d+\.\d+/)[0]

describe('gdf: framework detection', function() {
  const sandbox = useSandbox()

  const cases = [
    ['plain node', {}, 'Node.js'],
    ['astro', { dependencies: { astro: '^4' } }, 'Astro'],
    ['vite', { scripts: { dev: 'vite' } }, 'Vite'],
    ['remix', { dependencies: { '@remix-run/node': '^2' } }, 'Remix'],
    ['remix (legacy package)', { dependencies: { remix: '^1' } }, 'Remix'],
    ['meteor', { dependencies: { 'meteor-node-stubs': '^1' } }, 'Meteor'],
    ['next', { dependencies: { next: '13.0.0' }, scripts: {} }, 'Next.js'],
    ['waku', { dependencies: { waku: '1.0.0-rc.4' } }, 'Waku'],
    ['nuxt', { dependencies: { nuxt: '^3' } }, 'Nuxt'],
    ['nest', { dependencies: { '@nestjs/core': '^10' } }, 'NestJS'],
    ['gatsby', { dependencies: { gatsby: '^5' } }, 'Gatsby'],
    ['sveltekit', { devDependencies: { '@sveltejs/kit': '^2' } }, 'SvelteKit'],
    ['adonis', { dependencies: { '@adonisjs/core': '^5' } }, 'AdonisJS'],
    ['prisma', { dependencies: { '@prisma/client': '^5' } }, 'Node.js/Prisma'],
    ['prisma (cli only)', { devDependencies: { prisma: '^5' } }, 'Node.js/Prisma'],
    ['next + prisma', { dependencies: { next: '13.0.0', '@prisma/client': '^5' }, scripts: {} }, 'Next.js/Prisma']
  ]

  for (const [name, pj, runtime] of cases) {
    it(`detects ${name} as ${runtime}`, async function() {
      const gdf = await sandbox().run({ name: 'app', ...pj })
      expect(gdf.runtime).to.equal(runtime)
      expect(sandbox().read('Dockerfile')).to.include(`LABEL fly_launch_runtime="${runtime}"`)
    })
  }

  it('derives a user name from the runtime', async function() {
    const gdf = await sandbox().run({ dependencies: { next: '13.0.0', '@prisma/client': '^5' }, scripts: {} })
    expect(gdf.user).to.equal('nextjs')
  })

  it('distinguishes astro SSR from static', async function() {
    let gdf = await sandbox().run({ dependencies: { astro: '^4' } })
    expect(gdf.astroStatic).to.equal(true)
    expect(gdf.astroSSR).to.equal(false)

    gdf = await sandbox().run({ dependencies: { astro: '^4', '@astrojs/node': '^8' } })
    expect(gdf.astroStatic).to.equal(false)
    expect(gdf.astroSSR).to.equal(true)
  })

  it('detects astro and its adapter in devDependencies', async function() {
    let gdf = await sandbox().run({ devDependencies: { astro: '^5' } })
    expect(gdf.runtime).to.equal('Astro')
    expect(gdf.astroStatic).to.equal(true)

    gdf = await sandbox().run({ dependencies: { astro: '^5' }, devDependencies: { '@astrojs/node': '^9' } })
    expect(gdf.astroSSR).to.equal(true)
    // the adapter is needed at runtime, so it must not be pruned
    expect(sandbox().read('Dockerfile')).not.to.include('npm prune')
  })

  it('runs the start script for astro middleware mode', async function() {
    sandbox().write('astro.config.mjs', "export default defineConfig({ adapter: node({ mode: 'middleware' }) })")
    const gdf = await sandbox().run({ dependencies: { astro: '^5', '@astrojs/node': '^9' }, scripts: { start: 'node server.mjs' } })
    expect(gdf.astroSSR).to.equal(false)
    expect(gdf.astroStatic).to.equal(false)
    expect(gdf.startCommand).to.deep.equal(['npm', 'run', 'start'])
  })

  it('reads outDir and base from astro.config', async function() {
    sandbox().write('astro.config.ts', "export default defineConfig({ outDir: './build/', base: 'docs/' })")
    const gdf = await sandbox().run({ dependencies: { astro: '^5' } })
    expect(gdf.astroOutDir).to.equal('build')
    expect(gdf.astroBase).to.equal('/docs')
    expect(sandbox().read('Dockerfile')).to.include('COPY --from=build /app/build /usr/share/nginx/html/docs')
  })

  it('serves static sites with caddy when asked', async function() {
    await sandbox().run({ dependencies: { astro: '^5' } }, { caddy: true })
    const dockerfile = sandbox().read('Dockerfile')
    expect(dockerfile).to.include('FROM caddy:2-alpine')
    expect(dockerfile).to.include('COPY --from=build /app/dist /srv')
    expect(dockerfile).not.to.include('nginx')
  })

  it('detects trpc only when both client and server are present', async function() {
    let gdf = await sandbox().run({ dependencies: { '@trpc/server': '^10' } })
    expect(gdf.trpc).to.equal(false)

    gdf = await sandbox().run({ dependencies: { '@trpc/server': '^10', '@trpc/client': '^10' } })
    expect(gdf.trpc).to.equal(true)
  })

  it('detects shopify by the presence of shopify.app.toml', async function() {
    let gdf = await sandbox().run({})
    expect(gdf.shopify).to.equal(false)

    sandbox().write('shopify.app.toml', '')
    gdf = await sandbox().run({})
    expect(gdf.shopify).to.equal(true)
  })

  it('detects the epic stack', async function() {
    const gdf = await sandbox().run({ 'epic-stack': true })
    expect(gdf.epicStack).to.equal(true)
  })

  it('detects puppeteer and puppeteer-core', async function() {
    for (const dep of ['puppeteer', 'puppeteer-core']) {
      const gdf = await sandbox().run({ dependencies: { [dep]: '^22' } })
      expect(gdf.puppeteer).to.equal(true)
    }
  })

  // BUG: nextjsGeneration reads scripts.build without optional chaining, so a
  // next.js app with no "scripts" in package.json throws a TypeError.
  it.skip('handles next.js apps without scripts', async function() {
    const gdf = await sandbox().run({ dependencies: { next: '14.2.0' } })
    expect(gdf.runtime).to.equal('Next.js')
  })

  it('detects ESM packages', async function() {
    let gdf = await sandbox().run({ type: 'module' })
    expect(gdf.typeModule).to.equal(true)

    gdf = await sandbox().run({ type: 'commonjs' })
    expect(gdf.typeModule).to.equal(false)
  })
})

describe('gdf: databases', function() {
  const sandbox = useSandbox()

  const schema = (provider, url) => [
    'datasource db {',
    `  provider = "${provider}"`,
    `  url      = ${url}`,
    '}',
    ''
  ].join('\n')

  // an existing .dockerignore sidesteps the prisma .dockerignore template bug
  // (see 'gdf: .dockerignore'), keeping these tests about detection
  beforeEach(function() {
    sandbox().write('.dockerignore', '')
  })

  it('detects sqlite3 from dependencies', async function() {
    for (const dep of ['sqlite3', 'better-sqlite3']) {
      const gdf = await sandbox().run({ dependencies: { [dep]: '*' } })
      expect(gdf.sqlite3).to.equal(true)
    }
  })

  it('detects sqlite3 and postgres from the prisma schema', async function() {
    sandbox().write('prisma/schema.prisma', schema('sqlite', '"file:./dev.db"'))
    let gdf = await sandbox().run({ dependencies: { '@prisma/client': '^5' } })
    expect(gdf.sqlite3).to.equal(true)
    expect(gdf.postgres).to.equal(false)

    sandbox().write('prisma/schema.prisma', schema('postgresql', 'env("DATABASE_URL")'))
    gdf = await sandbox().run({ dependencies: { '@prisma/client': '^5' } })
    expect(gdf.sqlite3).to.equal(false)
    expect(gdf.postgres).to.equal(true)
  })

  it('ignores a prisma schema when prisma is not a dependency', async function() {
    sandbox().write('prisma/schema.prisma', schema('postgresql', 'env("DATABASE_URL")'))
    const gdf = await sandbox().run({})
    expect(gdf.postgres).to.equal(false)
  })

  it('detects postgres for adonis apps using pg', async function() {
    const gdf = await sandbox().run({ dependencies: { '@adonisjs/core': '^5', pg: '^8' } })
    expect(gdf.postgres).to.equal(true)
    expect(gdf.deployEnv.DB_CONNECTION).to.equal('pg')
  })

  it('extracts the sqlite file from a relative prisma url', async function() {
    sandbox().write('prisma/schema.prisma', schema('sqlite', '"file:./dev.db"'))
    const gdf = await sandbox().run({ dependencies: { '@prisma/client': '^5' } })
    expect(gdf.prismaFile).to.equal('./dev.db')
    expect(gdf.prismaEnv).to.equal(undefined)
  })

  it('extracts the sqlite file from an absolute prisma url', async function() {
    sandbox().write('prisma/schema.prisma', schema('sqlite', '"file:///data/sqlite.db"'))
    const gdf = await sandbox().run({ dependencies: { '@prisma/client': '^5' } })
    expect(gdf.prismaFile).to.equal('/data/sqlite.db')
  })

  it('extracts the env var name from a prisma url', async function() {
    sandbox().write('prisma/schema.prisma', schema('sqlite', 'env("DATABASE_URL")'))
    const gdf = await sandbox().run({ dependencies: { '@prisma/client': '^5' } })
    expect(gdf.prismaFile).to.equal(null)
    expect(gdf.prismaEnv).to.equal('DATABASE_URL')
  })

  it('returns null prisma details when there is no schema', async function() {
    const gdf = await sandbox().run({ dependencies: { '@prisma/client': '^5' } })
    expect(gdf.prismaFile).to.equal(null)
    expect(gdf.prismaEnv).to.equal(null)
  })

  it('reads the prisma seed command', async function() {
    let gdf = await sandbox().run({ dependencies: { '@prisma/client': '^5' }, prisma: { seed: 'node seed.js' } })
    expect(gdf.prismaSeed).to.equal('node seed.js')

    gdf = await sandbox().run({ prisma: { seed: 'node seed.js' } })
    expect(gdf.prismaSeed).to.equal(false)
  })

  it('sets DATABASE_URL for sqlite3 apps', async function() {
    const gdf = await sandbox().run({ dependencies: { sqlite3: '*' } })
    expect(gdf.deployEnv.DATABASE_URL).to.equal('file:///data/sqlite.db')
    expect(sandbox().read('Dockerfile')).to.include('VOLUME /data')
  })

  it('does not set DATABASE_URL when prisma names the file', async function() {
    sandbox().write('prisma/schema.prisma', schema('sqlite', '"file:./dev.db"'))
    const gdf = await sandbox().run({ dependencies: { '@prisma/client': '^5' } })
    expect(gdf.deployEnv).not.to.have.property('DATABASE_URL')
  })

  it('moves the database and bumps the port for litefs', async function() {
    const gdf = await sandbox().run({ dependencies: { sqlite3: '*' } }, { litefs: true })
    expect(gdf.deployEnv.DATABASE_URL).to.equal('file:///litefs/sqlite.db')
    expect(gdf.deployEnv.PORT).to.equal(3001)
  })

  it('treats litefs-js as enabling litefs and sqlite3', async function() {
    const gdf = await sandbox().run({ dependencies: { 'litefs-js': '*' } })
    expect(gdf.litefs).to.equal(true)
    expect(gdf.sqlite3).to.equal(true)
    expect(sandbox().exists('litefs.yml')).to.equal(true)
  })

  it('sets epic stack database environment', async function() {
    const gdf = await sandbox().run({ 'epic-stack': true, dependencies: { 'better-sqlite3': '*' } })
    expect(gdf.deployEnv).to.include({
      DATABASE_FILENAME: 'sqlite.db',
      LITEFS_DIR: '/litefs',
      DATABASE_PATH: '$LITEFS_DIR/$DATABASE_FILENAME',
      DATABASE_URL: 'file://$DATABASE_PATH',
      CACHE_DATABASE_FILENAME: 'cache.db',
      CACHE_DATABASE_PATH: '$LITEFS_DIR/$CACHE_DATABASE_FILENAME',
      PORT: 3001
    })
  })
})

describe('gdf: packagers', function() {
  const sandbox = useSandbox()

  const devDeps = { scripts: { build: 'tsc' }, devDependencies: { typescript: '^5' } }

  it('defaults to npm install', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.packager).to.equal('npm')
    expect(gdf.packagerInstall).to.equal('npm install')
    expect(gdf.packageFiles).to.deep.equal(['package.json'])
  })

  it('uses npm ci with a package-lock.json', async function() {
    sandbox().write('package-lock.json', '{}')
    const gdf = await sandbox().run({})
    expect(gdf.packager).to.equal('npm')
    expect(gdf.packagerInstall).to.equal('npm ci')
    expect(gdf.packageFiles).to.deep.equal(['package-lock.json', 'package.json'])
  })

  it('includes .npmrc and yarn config files in the package files', async function() {
    sandbox().write('.npmrc', '')
    sandbox().write('yarn.lock', '')
    sandbox().write('.yarnrc', '')
    sandbox().write('.yarnrc.yml', '')
    const gdf = await sandbox().run({ packageManager: 'yarn@1.22.19' })
    expect(gdf.packageFiles).to.deep.equal(['.npmrc', '.yarnrc', '.yarnrc.yml', 'package.json', 'yarn.lock'])
    expect(sandbox().read('Dockerfile')).to.include('COPY .npmrc .yarnrc .yarnrc.yml package.json yarn.lock ./')
  })

  it('uses a frozen lockfile for yarn classic', async function() {
    sandbox().write('yarn.lock', '')
    const gdf = await sandbox().run({ packageManager: 'yarn@1.22.19' })
    expect(gdf.packager).to.equal('yarn')
    expect(gdf.yarnVersion).to.equal('1.22.19')
    expect(gdf.packagerInstall).to.equal('yarn install --frozen-lockfile')
    expect(gdf.packagerPrune).to.equal('yarn install --production=true')
    expect(sandbox().read('Dockerfile')).to.include('RUN npm install -g yarn@$YARN_VERSION --force')
  })

  it('uses immutable installs for yarn 2', async function() {
    sandbox().write('yarn.lock', '')
    const gdf = await sandbox().run({ packageManager: 'yarn@2.4.3' })
    expect(gdf.packagerInstall).to.equal('yarn install --immutable --immutable-cache --check-cache')
  })

  it('uses immutable installs and corepack for yarn 3 and 4', async function() {
    for (const version of ['3.6.0', '4.1.0']) {
      sandbox().write('yarn.lock', '')
      const gdf = await sandbox().run({ packageManager: `yarn@${version}` })
      expect(gdf.packagerInstall).to.equal('yarn install --immutable')
      expect(sandbox().read('Dockerfile')).to.include('RUN corepack enable && \\\n    yarn set version ${YARN_VERSION}') // eslint-disable-line no-template-curly-in-string
    }
  })

  it('asks the installed yarn for its version when packageManager is absent', async function() {
    sandbox().stub('yarn', 'echo 3.2.1\n')
    sandbox().write('yarn.lock', '')
    const gdf = await sandbox().run({})
    expect(gdf.yarnVersion).to.equal('3.2.1')
  })

  it('falls back to yarn classic when yarn is not installed', async function() {
    sandbox().write('yarn.lock', '')
    const gdf = await sandbox().run({})
    expect(gdf.yarnVersion).to.equal(gdf.yarnClassic)
  })

  it('uses a frozen lockfile for pnpm', async function() {
    sandbox().write('pnpm-lock.yaml', '')
    const gdf = await sandbox().run({})
    expect(gdf.packager).to.equal('pnpm')
    expect(gdf.packagerInstall).to.equal('pnpm install --frozen-lockfile')
    expect(gdf.packagerPrune).to.equal('pnpm prune --prod')
  })

  it('pins the installed pnpm version, or latest', async function() {
    sandbox().write('pnpm-lock.yaml', '')
    let gdf = await sandbox().run({})
    expect(gdf.pnpmVersion).to.equal('latest')

    sandbox().stub('pnpm', 'echo 9.1.2\n')
    gdf = await sandbox().run({})
    expect(gdf.pnpmVersion).to.equal('9.1.2')
    expect(sandbox().read('Dockerfile')).to.include('ARG PNPM_VERSION=9.1.2')
  })

  for (const lockfile of ['bun.lockb', 'bun.lock']) {
    it(`uses bun with a ${lockfile}`, async function() {
      sandbox().stub('bun', 'echo 1.1.20\n')
      sandbox().write(lockfile, '')
      const gdf = await sandbox().run({})
      expect(gdf.packager).to.equal('bun')
      expect(gdf.bun).to.equal(true)
      expect(gdf.bunVersion).to.equal('1.1.20')
      expect(gdf.npx).to.equal('bunx')
      expect(gdf.packagerInstall).to.equal('bun install --ci')
      expect(gdf.packagerPrune).to.equal('rm -rf node_modules && \\\n    bun install --ci')
      expect(sandbox().read('Dockerfile')).to.include('FROM oven/bun:${BUN_VERSION}-slim AS base') // eslint-disable-line no-template-curly-in-string
    })
  }

  it('prefers bun over pnpm over yarn over npm lockfiles', async function() {
    sandbox().write('package-lock.json', '{}')
    sandbox().write('yarn.lock', '')
    expect((await sandbox().run({})).packager).to.equal('yarn')

    sandbox().write('pnpm-lock.yaml', '')
    expect((await sandbox().run({})).packager).to.equal('pnpm')

    sandbox().write('bun.lockb', '')
    expect((await sandbox().run({})).packager).to.equal('bun')
  })

  it('--bun selects bun without changing the packager', async function() {
    const gdf = await sandbox().run({}, { bun: true })
    expect(gdf.packager).to.equal('npm')
    expect(gdf.bun).to.equal(true)
    expect(gdf.npx).to.equal('bunx')
  })

  it('includes dev dependencies when there is a build step', async function() {
    sandbox().write('package-lock.json', '{}')
    let gdf = await sandbox().run(devDeps)
    expect(gdf.packagerInstall).to.equal('npm ci --include=dev')
    expect(gdf.build).to.equal('npm run build')
    expect(sandbox().read('Dockerfile')).to.include('RUN npm prune --omit=dev')

    fs.rmSync('package-lock.json')
    sandbox().write('yarn.lock', '')
    gdf = await sandbox().run({ ...devDeps, packageManager: 'yarn@1.22.19' })
    expect(gdf.packagerInstall).to.equal('yarn install --frozen-lockfile --production=false')
    expect(gdf.build).to.equal('yarn run build')

    fs.rmSync('yarn.lock')
    sandbox().write('pnpm-lock.yaml', '')
    gdf = await sandbox().run(devDeps)
    expect(gdf.packagerInstall).to.equal('pnpm install --frozen-lockfile --prod=false')
    expect(gdf.build).to.equal('pnpm run build')
  })

  it('does not ask bun to include dev dependencies', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    const gdf = await sandbox().run(devDeps)
    expect(gdf.packagerInstall).to.equal('bun install')
    expect(gdf.build).to.equal('bun run build')
  })

  it('uses bun --bun for builds whose tool is a node script', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('node_modules/.bin/tsc', '#!/usr/bin/env node\n')
    const gdf = await sandbox().run(devDeps)
    expect(gdf.bunNode).to.equal(true)
    expect(gdf.build).to.equal('bun --bun run build')
  })

  it('does not include dev dependencies when there are none', async function() {
    const gdf = await sandbox().run({ scripts: { build: 'echo' } })
    expect(gdf.packagerInstall).to.equal('npm install')
    expect(sandbox().read('Dockerfile')).not.to.include('Remove development dependencies')
  })

  it('--dev keeps dev dependencies in the final image', async function() {
    const gdf = await sandbox().run(devDeps, { dev: true })
    expect(gdf.dev).to.equal(true)
    expect(gdf.packagerInstall).to.equal('npm install --include=dev')
    expect(sandbox().read('Dockerfile')).not.to.include('Remove development dependencies')
  })

  it('always keeps dev dependencies for nest and adonis', async function() {
    for (const dep of ['@nestjs/core', '@adonisjs/core']) {
      const gdf = await sandbox().run({ dependencies: { [dep]: '*' }, devDependencies: { typescript: '*' } })
      expect(gdf.dev).to.equal(true)
    }
  })

  it('never reports dev without dev dependencies', async function() {
    const gdf = await sandbox().run({ dependencies: { '@nestjs/core': '*' } }, { dev: true })
    expect(gdf.dev).to.equal(false)
  })

  it('adds --legacy-peer-deps for npm and yarn berry, but not yarn classic', async function() {
    let gdf = await sandbox().run({}, { legacyPeerDeps: true })
    expect(gdf.packagerInstall).to.equal('npm install --legacy-peer-deps')
    expect(gdf.packagerPrune).to.equal('npm prune --omit=dev --legacy-peer-deps')

    sandbox().write('yarn.lock', '')
    gdf = await sandbox().run({ packageManager: 'yarn@4.1.0' }, { legacyPeerDeps: true })
    expect(gdf.packagerInstall).to.equal('yarn install --immutable --legacy-peer-deps')
    expect(gdf.packagerPrune).to.equal('yarn install --production=true --legacy-peer-deps')

    gdf = await sandbox().run({ packageManager: 'yarn@1.22.19' }, { legacyPeerDeps: true })
    expect(gdf.packagerInstall).to.equal('yarn install --frozen-lockfile')
    expect(gdf.packagerPrune).to.equal('yarn install --production=true')
  })

  it('adds --ignore-scripts', async function() {
    const gdf = await sandbox().run({}, { ignoreScripts: true })
    expect(gdf.packagerInstall).to.equal('npm install --ignore-scripts')
  })

  it('--build overrides the build script', async function() {
    const gdf = await sandbox().run(devDeps, { build: 'make' })
    expect(gdf.build).to.equal('make')
    expect(sandbox().read('Dockerfile')).to.include('RUN make\n')
  })

  it('treats --build=defer as --defer-build', async function() {
    const opts = { build: 'defer' }
    const gdf = await sandbox().run(devDeps, opts)
    expect(gdf.options.deferBuild).to.equal(true)
    expect(gdf.options.build).to.equal('')
    expect(gdf.packagerInstall).to.equal('npm install --include=dev')
    expect(sandbox().read('Dockerfile')).not.to.include('# Build application')
  })
})

describe('gdf: build cache', function() {
  const sandbox = useSandbox()

  it('is empty unless --cache is set', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.buildCache).to.equal('')
  })

  const cases = [
    ['npm', null, {}, 'npm', '/app/.npm'],
    ['yarn classic', 'yarn.lock', { packageManager: 'yarn@1.22.19' }, 'yarn', '/usr/local/share/.cache/yarn/'],
    ['yarn berry', 'yarn.lock', { packageManager: 'yarn@4.1.0' }, 'yarn', '/app/.yarn/berry/cache'],
    ['pnpm', 'pnpm-lock.yaml', {}, 'pnpm', '/pnpm/store'],
    ['bun', 'bun.lockb', {}, 'bun', '/root/.bun']
  ]

  for (const [name, lockfile, pj, id, target] of cases) {
    it(`mounts the ${name} cache`, async function() {
      sandbox().stub('bun', 'echo 1.1.20\n')
      if (lockfile) sandbox().write(lockfile, '')
      const gdf = await sandbox().run(pj, { cache: true })
      expect(gdf.buildCache).to.equal(`--mount=type=cache,id=${id},target=${target} \\\n    `)
    })
  }

  it('sets PNPM_HOME for pnpm caches', async function() {
    sandbox().write('pnpm-lock.yaml', '')
    const gdf = await sandbox().run({}, { cache: true })
    expect(gdf.buildEnv).to.deep.equal({ PNPM_HOME: '/pnpm', PATH: '$PNPM_HOME:$PATH' })
  })

  it('mounts apt and apk caches', async function() {
    let gdf = await sandbox().run({}, { cache: true })
    expect(gdf.pkg_cache).to.equal(
      '--mount=type=cache,id=cache,target=/var/cache/apt \\\n    --mount=type=cache,id=lib,target=/var/lib/apt \\'
    )
    expect(sandbox().read('Dockerfile')).not.to.include('rm -rf /var/lib/apt/lists')

    gdf = await sandbox().run({}, { cache: true, alpine: true })
    expect(gdf.pkg_cache).to.equal('--mount=type=cache,id=cache,target=/var/cache/apk \\')
  })
})

describe('gdf: system packages', function() {
  const sandbox = useSandbox()

  it('installs the standard build toolchain', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.buildPackages).to.deep.equal(['build-essential', 'node-gyp', 'pkg-config', 'python-is-python3'])
    expect(gdf.deployPackages).to.deep.equal([])
    expect(gdf.basePackages).to.deep.equal([])
  })

  it('omits node-gyp for bun', async function() {
    const gdf = await sandbox().run({}, { bun: true })
    expect(gdf.buildPackages).not.to.include('node-gyp')
  })

  it('adds git for git dependencies', async function() {
    for (const spec of ['git+https://github.com/a/b.git', 'git://github.com/a/b.git', 'github:a/b', 'a/b']) {
      const gdf = await sandbox().run({ dependencies: { b: spec } })
      expect(gdf.buildPackages, spec).to.include('git')
    }
  })

  it('does not add git for registry dependencies', async function() {
    const gdf = await sandbox().run({ dependencies: { b: '^1.0.0' } })
    expect(gdf.buildPackages).not.to.include('git')
  })

  it('adds git for git devDependencies only when they get installed', async function() {
    let gdf = await sandbox().run({ devDependencies: { b: 'github:a/b' } })
    expect(gdf.buildPackages).not.to.include('git')

    gdf = await sandbox().run({ scripts: { build: 'tsc' }, devDependencies: { b: 'github:a/b' } })
    expect(gdf.buildPackages).to.include('git')
  })

  it('adds framework-specific packages', async function() {
    let gdf = await sandbox().run({ dependencies: { 'meteor-node-stubs': '*' } })
    expect(gdf.buildPackages).to.include.members(['python3-pip', 'g++', 'make', 'curl'])

    gdf = await sandbox().run({ dependencies: { '@prisma/client': '*' } })
    expect(gdf.buildPackages).to.include('openssl')
    expect(gdf.deployPackages).to.include('openssl')

    gdf = await sandbox().run({ dependencies: { 'fluent-ffmpeg': '*' } })
    expect(gdf.deployPackages).to.deep.equal(['ffmpeg'])

    gdf = await sandbox().run({ dependencies: { puppeteer: '*' } })
    expect(gdf.deployPackages).to.deep.equal(['chromium', 'chromium-sandbox'])
    expect(gdf.deployEnv.PUPPETEER_EXECUTABLE_PATH).to.equal('/usr/bin/chromium')

    gdf = await sandbox().run({ dependencies: { '@remix-run/node': '*', sqlite3: '*' } })
    expect(gdf.deployPackages).to.include('sqlite3')
  })

  it('adds packages for litefs, litestream and nginx', async function() {
    let gdf = await sandbox().run({}, { litefs: true })
    expect(gdf.deployPackages).to.deep.equal(['ca-certificates', 'fuse3'])

    gdf = await sandbox().run({}, { litestream: true })
    expect(gdf.deployPackages).to.deep.equal(['ca-certificates', 'wget'])

    gdf = await sandbox().run({}, { nginxRoot: 'public' })
    expect(gdf.deployPackages).to.deep.equal(['nginx'])
  })

  it('adds user-specified packages to each stage, sorted', async function() {
    const packages = { base: ['zsh', 'curl'], build: ['libvips-dev'], deploy: ['vim', 'imagemagick'] }
    const gdf = await sandbox().run({}, { packages })
    expect(gdf.basePackages).to.deep.equal(['curl', 'zsh'])
    expect(gdf.buildPackages).to.include('libvips-dev')
    expect(gdf.deployPackages).to.deep.equal(['imagemagick', 'vim'])
    expect(sandbox().read('Dockerfile')).to.include('apt-get install --no-install-recommends -y curl zsh')
  })

  it('maps and dedupes package names on alpine', async function() {
    const packages = { base: [], build: ['python'], deploy: ['sqlite3'] }
    const gdf = await sandbox().run({ dependencies: { puppeteer: '*' } }, { alpine: true, packages })
    expect(gdf.variant).to.equal('alpine')
    expect(gdf.buildPackages).to.deep.equal(['build-base', 'gyp', 'pkgconfig', 'python3'])
    expect(gdf.deployPackages).to.deep.equal(['chromium', 'chromium-chromedriver', 'sqlite'])
    expect(gdf.pkg_update).to.equal('apk update')
    expect(gdf.pkg_install).to.equal('apk add')
    expect(gdf.pkg_cleanup).to.equal('/var/cache/apk/*')
    expect(sandbox().read('Dockerfile')).to.include('-alpine AS base')
  })

  it('uses apt on debian', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.variant).to.equal('slim')
    expect(gdf.pkg_update).to.equal('apt-get update -qq')
    expect(gdf.pkg_install).to.equal('apt-get install --no-install-recommends -y')
    expect(gdf.pkg_cleanup).to.equal('/var/lib/apt/lists /var/cache/apt/archives')
  })
})

describe('gdf: node version', function() {
  const sandbox = useSandbox()

  it('defaults to the running node version', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.nodeVersion).to.equal(currentNode)
    expect(sandbox().read('Dockerfile')).to.include(`ARG NODE_VERSION=${currentNode}`)
  })

  it('raises the version to meet engines.node', async function() {
    const gdf = await sandbox().run({ engines: { node: '>=99.1.2' } })
    expect(gdf.nodeVersion).to.equal('99.1.2')
  })

  it('treats a strict > as the next version', async function() {
    const gdf = await sandbox().run({ engines: { node: '>99' } })
    expect(gdf.nodeVersion).to.equal('100')
  })

  it('keeps the running version when it already satisfies engines.node', async function() {
    const major = parseInt(currentNode)
    const gdf = await sandbox().run({ engines: { node: `>=${major - 2}` } })
    expect(gdf.nodeVersion).to.equal(currentNode)
  })

  // BUG: version components are compared as strings, so "8" > "22" and an
  // app declaring support for node 8+ gets a node 8 image.
  it.skip('keeps the running version for single digit minimums', async function() {
    const gdf = await sandbox().run({ engines: { node: '>=8' } })
    expect(gdf.nodeVersion).to.equal(currentNode)
  })

  // BUG: same string comparison; "100" < "22" so the minimum is ignored.
  it.skip('raises the version for three digit minimums', async function() {
    const gdf = await sandbox().run({ engines: { node: '>=100' } })
    expect(gdf.nodeVersion).to.equal('100')
  })

  it('installs python-is-python3 on node 17+', async function() {
    const gdf = await sandbox().run({ engines: { node: '>=99' } })
    expect(gdf.python).to.equal('python-is-python3')
  })
})

describe('gdf: start command and port', function() {
  const sandbox = useSandbox()

  const cases = [
    ['a start script', { scripts: { start: 'node server.js' } }, ['npm', 'run', 'start']],
    ['an ESM module field', { type: 'module', module: 'server.mjs' }, ['node', 'server.mjs']],
    ['a main field', { main: 'app.js' }, ['node', 'app.js']],
    ['nothing at all', {}, ['node', 'index.js']],
    ['adonis', { dependencies: { '@adonisjs/core': '*' } }, ['node', '/app/build/server.js']],
    ['nuxt', { dependencies: { nuxt: '*' } }, ['node', '.output/server/index.mjs']],
    ['meteor', { dependencies: { 'meteor-node-stubs': '*' } }, ['node', 'main.js']],
    ['gatsby', { dependencies: { gatsby: '*' } }, ['npx', 'gatsby', 'serve', '-H', '0.0.0.0']],
    ['vite', { scripts: { dev: 'vite' } }, ['/usr/sbin/nginx', '-g', 'daemon off;']],
    ['astro static', { dependencies: { astro: '*' } }, ['/usr/sbin/nginx', '-g', 'daemon off;']],
    ['astro ssr', { dependencies: { astro: '*', '@astrojs/node': '*' } }, ['node', './dist/server/entry.mjs']],
    ['waku', { dependencies: { waku: '*' } }, ['node', 'dist/serve-node.js']],
    ['sveltekit', { devDependencies: { '@sveltejs/kit': '*' } }, ['node', './build/index.js']],
    ['remix-serve', { dependencies: { '@remix-run/node': '*' }, scripts: { start: 'remix-serve build' } }, ['npx', 'remix-serve', './build/index.js']],
    ['fastify', { scripts: { start: 'fastify start app.js' } }, ['npx', 'fastify', 'start', '--address', '0.0.0.0', 'app.js']],
    ['fastify with -a', { scripts: { start: 'fastify start -a 127.0.0.1 app.js' } }, ['npx', 'fastify', 'start', '-a', '127.0.0.1', 'app.js']],
    ['fastify with --address', { scripts: { start: 'fastify start --address :: app.js' } }, ['npx', 'fastify', 'start', '--address', '::', 'app.js']]
  ]

  for (const [name, pj, cmd] of cases) {
    it(`starts ${name} with ${cmd.join(' ')}`, async function() {
      const gdf = await sandbox().run(pj)
      expect(gdf.startCommand).to.deep.equal(cmd)
      expect(sandbox().read('Dockerfile')).to.include(`CMD ${JSON.stringify(cmd, null, 1).replaceAll(/\n\s*/g, ' ')}`)
    })
  }

  it('runs the start script with the detected packager', async function() {
    sandbox().write('pnpm-lock.yaml', '')
    const gdf = await sandbox().run({ scripts: { start: 'node server.js' } })
    expect(gdf.startCommand).to.deep.equal(['pnpm', 'run', 'start'])
  })

  it('uses bun for module, main and the default entry point', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('app.ts', '')

    let gdf = await sandbox().run({ main: 'app.ts' })
    expect(gdf.startCommand).to.deep.equal(['bun', 'app.ts'])

    gdf = await sandbox().run({})
    expect(gdf.startCommand).to.deep.equal(['bun', 'index.ts'])
  })

  it('resolves a Bun module entry point to its TypeScript file when type is unspecified', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/index.ts', '')

    const gdf = await sandbox().run({ module: 'src/index.js' })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/index.ts'])
  })

  it('keeps a Bun main entry point that has not been built yet', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/index.ts', '')

    const gdf = await sandbox().run({ main: 'dist/index.js' })
    expect(gdf.startCommand).to.deep.equal(['bun', 'dist/index.js'])
  })

  it('keeps an existing Bun index.ts over module and dev script entries', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('index.ts', '')
    sandbox().write('lib/index.js', '')
    sandbox().write('src/app.css', '')

    let gdf = await sandbox().run({ module: 'lib/index.js' })
    expect(gdf.startCommand).to.deep.equal(['bun', 'index.ts'])

    gdf = await sandbox().run({ module: 'dist/index.mjs' })
    expect(gdf.startCommand).to.deep.equal(['bun', 'index.ts'])

    gdf = await sandbox().run({ scripts: { dev: 'bun --watch index.ts & bunx tailwindcss -i src/app.css' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'index.ts'])
  })

  it('skips Bun dev script arguments that are not script files', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/server.ts', '')
    sandbox().write('src/app.css', '')
    sandbox().write('prisma/schema.prisma', '')

    let gdf = await sandbox().run({ scripts: { dev: 'bun --watch src/server.ts --port $PORT' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/server.ts'])

    gdf = await sandbox().run({ scripts: { dev: 'bun --watch src/server.ts & bunx tailwindcss -i src/app.css & bunx prisma studio' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/server.ts'])
  })

  it('keeps a Bun main entry point that is compiled from TypeScript', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('index.ts', '')

    const gdf = await sandbox().run({ main: 'index.js', scripts: { build: 'tsc' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'index.js'])
  })

  it('uses the file run by the last bun command in the dev script', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/server.ts', '')
    sandbox().write('scripts/codegen.ts', '')
    sandbox().write('drizzle.config.ts', '')
    sandbox().write('instrument.ts', '')

    for (const dev of [
      'bun run scripts/codegen.ts && bun --watch src/server.ts',
      'bunx drizzle-kit push --config drizzle.config.ts && bun --watch src/server.ts',
      'bun --preload ./instrument.ts src/server.ts',
      'NODE_ENV=development bun --watch src/server.ts'
    ]) {
      const gdf = await sandbox().run({ scripts: { dev } })
      expect(gdf.startCommand, dev).to.deep.equal(['bun', 'src/server.ts'])
    }
  })

  it('runs a Bun dev entry point in the directory the dev script changes to', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/index.ts', '')
    sandbox().write('apps/api/src/index.ts', '')

    let gdf = await sandbox().run({ scripts: { dev: 'cd apps/api && bun --watch src/index.ts' } })
    expect(gdf.startCommand).to.deep.equal(['bun', '--cwd', 'apps/api', 'src/index.ts'])

    gdf = await sandbox().run({ scripts: { dev: 'cd apps && cd api && bun --watch ./src/index.js' } })
    expect(gdf.startCommand).to.deep.equal(['bun', '--cwd', 'apps/api', 'src/index.ts'])

    expect(sandbox().read('Dockerfile')).to.include('CMD [ "bun", "--cwd", "apps/api", "src/index.ts" ]')
  })

  it('treats arguments after the Bun dev entry point as its argv', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/server.ts', '')
    sandbox().write('drizzle.config.ts', '')

    for (const dev of [
      'bun --watch src/server.ts --config drizzle.config.ts',
      'bun --watch src/server.ts > log.txt 2>&1',
      'bun --watch src/server.ts # drizzle.config.ts'
    ]) {
      const gdf = await sandbox().run({ scripts: { dev } })
      expect(gdf.startCommand, dev).to.deep.equal(['bun', 'src/server.ts'])
    }
  })

  it('does not follow cd out of Bun dev script subshells and background jobs', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('server.ts', '')
    sandbox().write('web/server.ts', '')

    for (const dev of [
      '(cd web && vite) & bun --watch server.ts',
      'cd web && vite & bun --watch server.ts',
      'cd ./ && bun --watch server.ts'
    ]) {
      const gdf = await sandbox().run({ scripts: { dev } })
      expect(gdf.startCommand, dev).to.deep.equal(['bun', 'server.ts'])
    }

    const gdf = await sandbox().run({ scripts: { dev: 'cd web/ && bun --watch server.ts' } })
    expect(gdf.startCommand).to.deep.equal(['bun', '--cwd', 'web', 'server.ts'])
  })

  it('resolves a missing Bun main or module to its TypeScript source unless a script builds it', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/index.ts', '')
    sandbox().write('src/worker.cts', '')

    let gdf = await sandbox().run({ type: 'module', module: 'src/index.js' })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/index.ts'])

    gdf = await sandbox().run({ main: 'src/worker.cjs' })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/worker.cts'])

    gdf = await sandbox().run({ type: 'module', module: 'src/index.js', scripts: { build: 'tsc' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/index.js'])

    gdf = await sandbox().run({ main: 'src/index.js', scripts: { prepare: 'tsc' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/index.js'])
  })

  it('prefers a Bun module built by a script over the dev script entry point', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/server.ts', '')

    const gdf = await sandbox().run({
      module: 'dist/index.mjs',
      scripts: { build: 'bun build src/server.ts --outdir dist', dev: 'bun --watch src/server.ts' }
    })
    expect(gdf.startCommand).to.deep.equal(['bun', 'dist/index.mjs'])
  })

  it('ignores Bun dev script entry points outside the app', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/index.ts', '')

    for (const dev of ['cd .. && bun --watch src/index.ts', 'cd /srv && bun src/index.ts', 'cd ~ && bun src/index.ts', 'cd && bun src/index.ts']) {
      const gdf = await sandbox().run({ scripts: { dev } })
      expect(gdf.startCommand, dev).to.deep.equal(['bun', 'src/index.ts'])
    }
  })

  it('prefers a Bun src/index.ts over the dev script entry point', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/index.ts', '')
    sandbox().write('src/dev.ts', '')

    const gdf = await sandbox().run({ scripts: { dev: 'bun --watch src/dev.ts' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/index.ts'])
  })

  it('resolves a Bun module entry point to its TSX file', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/index.tsx', '')

    const gdf = await sandbox().run({ module: 'src/index.js' })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/index.tsx'])
  })

  it('keeps a Bun module entry point that has not been built yet', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')

    const gdf = await sandbox().run({ module: 'dist/index.mjs' })
    expect(gdf.startCommand).to.deep.equal(['bun', 'dist/index.mjs'])
  })

  it('skips a Bun module entry point that does not exist', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/server.ts', '')

    const gdf = await sandbox().run({ module: 'dist/index.mjs', scripts: { dev: 'bun --watch src/server.ts' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/server.ts'])
  })

  it('uses the Bun dev entry point without --watch', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/server.ts', '')

    const gdf = await sandbox().run({ scripts: { dev: 'bun --watch src/server.ts' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/server.ts'])
  })

  it('runs a Bun start script when one is defined', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')

    const gdf = await sandbox().run({ scripts: { start: 'bun src/server.ts' } })
    expect(gdf.startCommand).to.deep.equal(['bun', 'run', 'start'])
  })

  it('uses src/index.ts when a Bun project has no module or dev entry point', async function() {
    sandbox().stub('bun', 'echo 1.1.20\n')
    sandbox().write('bun.lockb', '')
    sandbox().write('src/index.ts', '')

    const gdf = await sandbox().run({})
    expect(gdf.startCommand).to.deep.equal(['bun', 'src/index.ts'])
  })

  it('starts standalone next.js with server.js', async function() {
    for (const config of ['next.config.js', 'next.config.mjs']) {
      fs.rmSync('next.config.js', { force: true })
      sandbox().write(config, 'export default { output: "standalone" }\n')
      const gdf = await sandbox().run({ dependencies: { next: '13.0.0' }, scripts: {} })
      expect(gdf.standaloneNextjs, config).to.equal(true)
      expect(gdf.startCommand).to.deep.equal(['node', 'server.js'])
    }
  })

  it('does not treat other next.js outputs as standalone', async function() {
    sandbox().write('next.config.js', 'module.exports = { output: "export" }\n')
    const gdf = await sandbox().run({ dependencies: { next: '13.0.0' }, scripts: {} })
    expect(gdf.standaloneNextjs).to.equal(false)
  })

  it('--cmd overrides the start command verbatim', async function() {
    const gdf = await sandbox().run({ scripts: { start: 'node a.js' } }, { cmd: 'node b.js' })
    expect(gdf.startCommand).to.equal('node b.js')
    expect(sandbox().read('Dockerfile')).to.include('CMD node b.js\n')
  })

  it('starts through foreman when nginx serves static files', async function() {
    const gdf = await sandbox().run({ scripts: { start: 'node server.js' } }, { nginxRoot: 'public' })
    expect(gdf.foreman).to.equal(true)
    expect(gdf.startCommand).to.deep.equal(['npx', 'foreman', 'start', '--procfile', 'Procfile.prod'])
    const dockerfile = sandbox().read('Dockerfile')
    expect(dockerfile).to.include('root /app/public;')
    expect(dockerfile).to.include('proxy_pass http://localhost:3001;')
    expect(dockerfile).to.include('nginx: /usr/sbin/nginx -g "daemon off;"')
  })

  const ports = [
    ['node', {}, 3000],
    ['gatsby', { dependencies: { gatsby: '*' } }, 8080],
    ['vite', { scripts: { dev: 'vite' } }, 80],
    ['astro static', { dependencies: { astro: '*' } }, 80],
    ['astro ssr', { dependencies: { astro: '*', '@astrojs/node': '*' } }, 4321]
  ]

  for (const [name, pj, port] of ports) {
    it(`exposes port ${port} for ${name}`, async function() {
      const gdf = await sandbox().run(pj)
      expect(gdf.port).to.equal(port)
      expect(sandbox().read('Dockerfile')).to.include(`EXPOSE ${port}\n`)
    })
  }

  it('sets PORT for the Waku production server', async function() {
    const gdf = await sandbox().run({ dependencies: { waku: '*' } })
    expect(gdf.port).to.equal(3000)
    expect(gdf.deployEnv.PORT).to.equal('3000')
  })

  it('--port overrides the port', async function() {
    const gdf = await sandbox().run({ dependencies: { gatsby: '*' } }, { port: 9999 })
    expect(gdf.port).to.equal(9999)
    expect(sandbox().read('Dockerfile')).to.include('EXPOSE 9999\n')
  })
})

describe('gdf: distroless', function() {
  const sandbox = useSandbox()

  it('uses a distroless image and parses the start script', async function() {
    const gdf = await sandbox().run({ scripts: { start: 'node "my server.js" --flag' } }, { distroless: true })
    expect(gdf.distroless).to.equal(true)
    expect(gdf.startCommand).to.deep.equal(['node', 'my server.js', '--flag'])

    const dockerfile = sandbox().read('Dockerfile')
    expect(dockerfile).to.include('FROM gcr.io/distroless/nodejs${NODE_VERSION}') // eslint-disable-line no-template-curly-in-string
    expect(dockerfile).to.include(`ARG NODE_VERSION=${parseInt(currentNode) & ~1}`)
  })

  it('is disabled when an entrypoint is needed', async function() {
    const gdf = await sandbox().run({ scripts: { start: 'node a.js' } }, { distroless: true, entrypoint: 'tini' })
    expect(gdf.distroless).to.equal(false)
  })
})

describe('gdf: environment, args and secrets', function() {
  const sandbox = useSandbox()

  it('always sets NODE_ENV=production in the base stage', async function() {
    const vars = { base: { NODE_ENV: 'development', FOO: 'bar' }, build: {}, deploy: {} }
    const gdf = await sandbox().run({}, { vars })
    expect(gdf.baseEnv).to.deep.equal({ NODE_ENV: 'production', FOO: 'bar' })
  })

  it('lets user deploy vars be overridden by detected ones', async function() {
    const vars = { base: {}, build: {}, deploy: { HOST: 'localhost', OTHER: '1' } }
    const gdf = await sandbox().run({ dependencies: { nuxt: '*' } }, { vars })
    expect(gdf.deployEnv).to.deep.equal({ HOST: 0, OTHER: '1' })
  })

  it('sets adonis deploy environment', async function() {
    const gdf = await sandbox().run({ dependencies: { '@adonisjs/core': '*' } })
    expect(gdf.deployEnv).to.deep.equal({
      HOST: '0.0.0.0',
      PORT: '3000',
      CACHE_VIEWS: 'true',
      SESSION_DRIVER: 'cookie',
      DRIVE_DISK: 'local'
    })
  })

  it('emits sorted ENV on one instruction', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.emitEnv({ B: '2', A: 1 })).to.equal('ENV A=1 \\\n    B="2"')
  })

  it('emits ENV in order, one per line, when values reference variables', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.emitEnv({ B: 'x', A: '$B/y' })).to.equal('ENV B="x"\nENV A="$B/y"')
    expect(gdf.sortEnv({ B: 'x', A: '$B/y' })).to.equal('B="x"\nENV A="$B/y"')
    expect(gdf.sortEnv({ B: '2', A: '1' })).to.equal('A="1" \\\n    B="2"')
  })

  it('emits ARG in insertion order', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.emitArgs({ B: '2', A: '1' })).to.equal('ARG B="2" \\\n    A="1"')
  })

  it('writes args and vars into each stage', async function() {
    await sandbox().run({ scripts: { build: 'echo' } }, {
      args: { base: { BASE_ARG: '1' }, build: { BUILD_ARG: '2' }, deploy: { DEPLOY_ARG: '3' } },
      vars: { base: { BASE_VAR: 'a' }, build: { BUILD_VAR: 'b' }, deploy: { DEPLOY_VAR: 'c' } }
    })

    const dockerfile = sandbox().read('Dockerfile')
    expect(dockerfile).to.include('# Base arguments \nARG BASE_ARG="1"')
    expect(dockerfile).to.include('# Build arguments\nARG BUILD_ARG="2"')
    expect(dockerfile).to.include('# Deploy arguments \nARG DEPLOY_ARG="3"')
    expect(dockerfile).to.include('ENV BASE_VAR="a" \\\n    NODE_ENV="production"')
    expect(dockerfile).to.include('ENV BUILD_VAR="b"')
    expect(dockerfile).to.include('ENV DEPLOY_VAR="c"')
  })

  it('mounts build secrets', async function() {
    const gdf = await sandbox().run({ scripts: { build: 'make' } }, { secrets: ['A', 'B'] })
    expect(gdf.mountSecrets).to.equal([
      '--mount=type=secret,id=A',
      '--mount=type=secret,id=B',
      'A="$(cat /run/secrets/A)"',
      'B="$(cat /run/secrets/B)"',
      ''
    ].join(' \\\n    '))
    expect(sandbox().read('Dockerfile')).to.include('RUN --mount=type=secret,id=A')
  })

  it('mounts nothing without secrets', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.mountSecrets).to.equal('')
  })
})

describe('gdf: custom instructions', function() {
  const sandbox = useSandbox()

  it('inlines instruction files into each stage', async function() {
    sandbox().write('base.txt', 'RUN echo base\n\n')
    sandbox().write('build.txt', 'RUN echo build')
    sandbox().write('deploy.txt', 'RUN echo deploy')

    const gdf = await sandbox().run({}, { instructions: { base: 'base.txt', build: 'build.txt', deploy: 'deploy.txt' } })
    expect(gdf.options.instructions.base).to.equal('RUN echo base')

    const dockerfile = sandbox().read('Dockerfile')
    const base = dockerfile.indexOf('RUN echo base')
    const build = dockerfile.indexOf('RUN echo build')
    const deploy = dockerfile.indexOf('RUN echo deploy')
    expect(base).to.be.greaterThan(0)
    expect(build).to.be.greaterThan(dockerfile.indexOf('FROM base AS build'))
    expect(deploy).to.be.greaterThan(dockerfile.indexOf('# Final stage for app image'))
  })

  it('reports and skips missing instruction files', async function() {
    const gdf = await sandbox().run({}, { instructions: { base: null, build: 'missing.txt', deploy: null } })
    expect(gdf.options.instructions.build).to.equal('')
    expect(sandbox().output.join('\n')).to.include('ENOENT')
  })
})

describe('gdf: entrypoint', function() {
  const sandbox = useSandbox()

  const sqlite = 'datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}\n'

  // sidestep the prisma .dockerignore template bug (see 'gdf: .dockerignore')
  beforeEach(function() {
    sandbox().write('.dockerignore', '')
  })

  it('is not needed for plain apps', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.entrypoint).to.equal(null)
    expect(sandbox().exists('docker-entrypoint.js')).to.equal(false)
    expect(sandbox().read('Dockerfile')).not.to.include('ENTRYPOINT')
  })

  it('--entrypoint is used verbatim', async function() {
    const gdf = await sandbox().run({}, { entrypoint: 'tini' })
    expect(gdf.entrypoint).to.equal('"tini"')
  })

  it('writes an executable entrypoint for prisma + sqlite', async function() {
    sandbox().write('prisma/schema.prisma', sqlite)
    const gdf = await sandbox().run({ dependencies: { '@prisma/client': '*' } })
    expect(gdf.entrypoint).to.equal('[ "/app/docker-entrypoint.js" ]')
    expect(fs.statSync('docker-entrypoint.js').mode & 0o777).to.equal(0o755)
    expect(sandbox().read('Dockerfile')).to.include('# Entrypoint prepares the database.\nENTRYPOINT [ "/app/docker-entrypoint.js" ]')
  })

  it('wraps the entrypoint with litefs', async function() {
    sandbox().write('prisma/schema.prisma', sqlite)
    const gdf = await sandbox().run({ dependencies: { '@prisma/client': '*' } }, { litefs: true })
    expect(gdf.entrypoint).to.equal('[ "litefs", "mount", "--", "/app/docker-entrypoint.js" ]')
  })

  it('writes an entrypoint for adonis', async function() {
    const gdf = await sandbox().run({ dependencies: { '@adonisjs/core': '*' } })
    expect(gdf.entrypoint).to.equal('[ "/app/docker-entrypoint.js" ]')
    expect(sandbox().exists('docker-entrypoint.js')).to.equal(true)
  })

  it('writes an entrypoint for swap when not deploying to fly', async function() {
    const gdf = await sandbox().run({}, { swap: '512M' })
    expect(gdf.entrypoint).to.equal('[ "/app/docker-entrypoint.js" ]')
    expect(sandbox().read('docker-entrypoint.js')).to.include('swap')
  })

  it('writes an entrypoint for next.js 14.2+', async function() {
    const gdf = await sandbox().run({ dependencies: { next: '^14.2.3' }, scripts: { build: 'next build' } })
    expect(gdf.nextjsGeneration).to.equal(true)
    expect(gdf.build).to.equal('npx next build --experimental-build-mode compile')
    expect(gdf.entrypoint).to.equal('[ "/app/docker-entrypoint.js" ]')
  })

  it('does not use experimental builds for older next.js', async function() {
    const gdf = await sandbox().run({ dependencies: { next: '^14.1.0' }, scripts: { build: 'next build' } })
    expect(gdf.nextjsGeneration).to.equal(false)
    expect(gdf.build).to.equal('npm run build')
  })

  // BUG: versions are compared as strings, so "9.5.0" >= "14.2".
  it.skip('does not use experimental builds for single digit next.js majors', async function() {
    const gdf = await sandbox().run({ dependencies: { next: '9.5.0' }, scripts: { build: 'next build' } })
    expect(gdf.nextjsGeneration).to.equal(false)
  })

  it('puts the entrypoint under other/ for remix apps that have one', async function() {
    sandbox().write('other/.keep', '')
    sandbox().write('prisma/schema.prisma', sqlite)
    const gdf = await sandbox().run({ dependencies: { '@remix-run/node': '*', '@prisma/client': '*' } })
    expect(gdf.configDir).to.equal('other/')
    expect(gdf.entrypoint).to.equal('[ "/app/other/docker-entrypoint.js" ]')
    expect(sandbox().exists('other/docker-entrypoint.js')).to.equal(true)
  })

  it('writes dbsetup.js instead when skipping an existing Dockerfile', async function() {
    sandbox().write('prisma/schema.prisma', sqlite)
    sandbox().write('Dockerfile', 'FROM scratch\n')
    const gdf = await sandbox().run({ dependencies: { '@prisma/client': '*' } }, { force: false, skip: true })
    expect(gdf.setupScriptType).to.equal('dbsetup')
    expect(sandbox().exists('dbsetup.js')).to.equal(true)
    expect(sandbox().exists('docker-entrypoint.js')).to.equal(false)
    expect(sandbox().read('Dockerfile')).to.equal('FROM scratch\n')
  })

  it('adds fixups for entrypoints that are not executable or use CRLF', async function() {
    sandbox().write('docker-entrypoint.js', '#!/usr/bin/env node\n')
    fs.chmodSync('docker-entrypoint.js', 0o755)
    let gdf = await sandbox().run({})
    expect(gdf.entrypointFixups).to.deep.equal([])

    fs.chmodSync('docker-entrypoint.js', 0o644)
    expect(gdf.entrypointFixups).to.deep.equal(['chmod +x ./docker-entrypoint.js'])

    fs.chmodSync('docker-entrypoint.js', 0o755)
    sandbox().write('docker-entrypoint.js', '#!/usr/bin/env node\r\n')
    expect(gdf.entrypointFixups).to.deep.equal(['sed -i "s/\\r$//g" ./docker-entrypoint.js'])

    sandbox().write('docker-entrypoint.js', '#!/usr/bin/env node\n')
    gdf = await sandbox().run({}, { windows: true })
    expect(gdf.entrypointFixups).to.have.length(2)
  })

  it('has no fixups without an entrypoint file', async function() {
    const gdf = await sandbox().run({})
    expect(gdf.entrypointFixups).to.deep.equal([])
  })
})

describe('gdf: litefs and litestream config', function() {
  const sandbox = useSandbox()

  it('writes litefs.yml and copies it into the image', async function() {
    await sandbox().run({ dependencies: { sqlite3: '*' } }, { litefs: true })
    expect(sandbox().exists('litefs.yml')).to.equal(true)
    expect(sandbox().read('Dockerfile')).to.include('COPY --link litefs.yml /etc/litefs.yml')
  })

  it('writes litestream.yml only when prisma names a sqlite file', async function() {
    await sandbox().run({}, { litestream: true })
    expect(sandbox().exists('litestream.yml')).to.equal(false)

    sandbox().write('prisma/schema.prisma', 'datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}\n')
    await sandbox().run({ dependencies: { '@prisma/client': '*' } }, { litestream: true })
    expect(sandbox().exists('litestream.yml')).to.equal(true)
    expect(sandbox().read('Dockerfile')).to.include('Install litestream')
  })
})

describe('gdf: file writing', function() {
  const sandbox = useSandbox()

  it('creates a Dockerfile and reports it', async function() {
    await sandbox().run({})
    expect(sandbox().read('Dockerfile')).to.match(/^# syntax = docker\/dockerfile:1\n/)
    expect(sandbox().output.join('\n')).to.match(/create\s+Dockerfile/)
  })

  it('leaves identical files alone', async function() {
    await sandbox().run({})
    sandbox().output.length = 0
    await sandbox().run({}, { force: false })
    expect(sandbox().output.join('\n')).to.match(/identical\s+Dockerfile/)
  })

  it('--skip keeps a conflicting file', async function() {
    sandbox().write('Dockerfile', 'FROM scratch\n')
    await sandbox().run({}, { force: false, skip: true })
    expect(sandbox().read('Dockerfile')).to.equal('FROM scratch\n')
    expect(sandbox().output.join('\n')).to.match(/skip\s+Dockerfile/)
  })

  it('--force overwrites a conflicting file', async function() {
    sandbox().write('Dockerfile', 'FROM scratch\n')
    await sandbox().run({})
    expect(sandbox().read('Dockerfile')).to.include('# syntax = docker/dockerfile:1')
    expect(sandbox().output.join('\n')).to.match(/force\s+Dockerfile/)
  })

  it('is idempotent', async function() {
    const pj = { scripts: { start: 'node index.js', build: 'tsc' }, devDependencies: { typescript: '*' } }
    await sandbox().run(pj)
    const first = sandbox().read('Dockerfile')
    await sandbox().run(pj)
    expect(sandbox().read('Dockerfile')).to.equal(first)
  })

  it('uses COPY --link when requested', async function() {
    await sandbox().run({}, { link: true })
    expect(sandbox().read('Dockerfile')).to.include('COPY --link package.json ./')
    expect(sandbox().read('Dockerfile')).to.include('COPY --link . .')
  })
})

describe('gdf: .dockerignore', function() {
  const sandbox = useSandbox()

  it('writes the default template when there is no .gitignore', async function() {
    await sandbox().run({})
    const ignore = sandbox().read('.dockerignore')
    expect(ignore).to.include('node_modules')
    expect(ignore).to.include('Dockerfile')
  })

  it('derives from .gitignore, keeping package files', async function() {
    sandbox().write('package-lock.json', '{}')
    sandbox().write('.gitignore', '# deps\nnode_modules\n\npackage-lock.json\n.env\n')
    await sandbox().run({})
    expect(sandbox().read('.dockerignore')).to.equal('# deps\nnode_modules\n\n# package-lock.json\n.env\n')
  })

  it('keeps prisma migrations', async function() {
    sandbox().write('.gitignore', 'prisma/migrations\n')
    await sandbox().run({ dependencies: { '@prisma/client': '*' } })
    expect(sandbox().read('.dockerignore')).to.equal('# prisma/migrations\n')
  })

  it('ignores the local sqlite database', async function() {
    sandbox().write('.gitignore', 'node_modules\n')
    sandbox().write('prisma/schema.prisma', 'datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}\n')
    await sandbox().run({ dependencies: { '@prisma/client': '*' } })
    expect(sandbox().read('.dockerignore')).to.include('# sqlite3 database\ndev.db\nprisma/dev.db\n')
  })

  // BUG: .dockerignore.ejs calls path.join() for prisma sqlite apps, but
  // `path` is only exposed to templates when litestream is enabled, so a
  // prisma + sqlite app without a .gitignore crashes with "path is not defined".
  it.skip('writes the default template for prisma sqlite apps', async function() {
    sandbox().write('prisma/schema.prisma', 'datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}\n')
    await sandbox().run({ dependencies: { '@prisma/client': '*' } })
    expect(sandbox().read('.dockerignore')).to.include('prisma/dev.db')
  })

  it('never touches an existing .dockerignore', async function() {
    sandbox().write('.dockerignore', 'custom\n')
    sandbox().write('.gitignore', 'node_modules\n')
    await sandbox().run({})
    expect(sandbox().read('.dockerignore')).to.equal('custom\n')
  })
})

describe('gdf: sveltekit adapter', function() {
  const sandbox = useSandbox()

  it('switches svelte.config.js to adapter-node', async function() {
    sandbox().write('svelte.config.js', "import adapter from '@sveltejs/adapter-auto'\n")
    await sandbox().run({ devDependencies: { '@sveltejs/kit': '*' } })
    expect(sandbox().read('svelte.config.js')).to.equal("import adapter from '@sveltejs/adapter-node'\n")
  })

  it('leaves adapter-node alone', async function() {
    const config = "import adapter from '@sveltejs/adapter-node'\n"
    sandbox().write('svelte.config.js', config)
    await sandbox().run({ devDependencies: { '@sveltejs/kit': '*' } })
    expect(sandbox().read('svelte.config.js')).to.equal(config)
  })

  it('does not touch non-svelte apps', async function() {
    const config = "import adapter from '@sveltejs/adapter-auto'\n"
    sandbox().write('svelte.config.js', config)
    await sandbox().run({})
    expect(sandbox().read('svelte.config.js')).to.equal(config)
  })
})

describe('gdf: adonis uploads', function() {
  const sandbox = useSandbox()

  it('creates an uploads volume when the local drive is used', async function() {
    sandbox().write('config/drive.ts', "root: Application.tmpPath('uploads')\n")
    const gdf = await sandbox().run({ dependencies: { '@adonisjs/core': '*' } })
    expect(gdf.adonisjsFileUpload).to.equal(true)
    expect(sandbox().read('Dockerfile')).to.include('VOLUME /app/tmp/uploads')
  })

  it('does not without a drive config', async function() {
    const gdf = await sandbox().run({ dependencies: { '@adonisjs/core': '*' } })
    expect(gdf.adonisjsFileUpload).to.equal(false)
  })
})
