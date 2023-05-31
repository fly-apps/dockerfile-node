## Overview

Provides a Node.js generator to produce Dockerfiles and related files.  It is intended to support any framework that lists its dependencies, includes a `start` script in `package.json`, and optionally includes a `build` script.

See [test](./test) for a list of frameworks and examples of Dockerfiles produced based on the associated `package.json` and lock files.

See [blog post](https://fly.io/blog/flydotio-heart-js/) for more information.

## Usage

To run once:

```
npx --yes @flydotio/dockerfile@latest
```

Or install it with your favorite package manager:

```
npm install @flydotio/dockerfile --save-dev
pnpm add -D @flydotio/dockerfile
yarn add @flydotio/dockerfile --dev
```

Once installed, you can run and re-run using:

```
npx dockerfile
```

Options are saved between runs into `package.json`. To invert a boolean options, add or remove a no- prefix from the option name.

### Options:

* `--distroless` - use [distroless](https://github.com/GoogleContainerTools/distroless) base image to reduce image size
* `--ignore-scripts` - do not execute any scripts defined in the project `package.json` and its dependencies.
* `--force` - overwrite existing files
* `--legacy-peer-deps` - [ignore peer dependencies](https://docs.npmjs.com/cli/v7/using-npm/config#legacy-peer-deps).
* `--litefs` - configure and enable [litefs](https://fly.io/docs/litefs/).
* `--no-link` - don't add [--link](https://docs.docker.com/engine/reference/builder/#copy---link) to COPY statements.  Some tools (like at the moment, [buildah](https://www.redhat.com/en/topics/containers/what-is-buildah)) don't yet support this feature.
* `--port=n` - expose port (default may vary based on framework, but otherwise is `3000`)
* `--swap=n` - allocate swap space.  See [falloc options](https://man7.org/linux/man-pages/man1/fallocate.1.html#OPTIONS) for suffixes
* `--windows` - make Dockerfile work for Windows users that may have set `git config --global core.autocrlf true`.

## Platform specific processing

In addition to creating Dockerfiles and associated artifacts, `dockerfile-node` can run platform specific processing.  At the present time the first and only platform taking advantage of this is naturally fly.io.

If, and only if, `flyctl` is installed, part of the path, and there exists a valid `fly.toml` file in the current directory, dockerfile-node will:

 * configure and create volume(s) for sqlite3
 * attach consul for litefs
 * set secrets for remix apps
 * initialize git
 * define a staging app if one is mentioned in `.github/workflows/deploy.yml`

## Testing

A single invocation of `npm test` will run all of the tests defined.  Additionally `npm run eslint` will run eslint.

The current integration testing strategy is to run the dockerfile generator against various configurations and compare the generated artifacts with expected results.  `ARG` values in `Dockerfiles` are masked before comparison.

To assis with this process, outputs of tests can be captured automatically.  This is useful when adding new tests and when making a change that affects many tests.  Be sure to inspect the output (e.g., by using `git diff`) before committing.

```
npm run test:capture
```

Additionally, each the outputs in each test directory can be directly tested to ensure that they can be successfully built by running docker buildx directory passing in the necessary build arguments.  For example:

```
docker buildx build . --build-arg NODE_VERSION=18
```
