## Overview

Provides a Node.js generator to produce Dockerfiles and related files.  It is intended to support any framework that lists its dependencies, includes a `start` script in `package.json`, and optionally includes a `build` script.

See [test](./test) for a list of frameworks and examples of Dockerfiles produced based on the associated `package.json` and lock files.

See [blog post](https://fly.io/blog/flydotio-heart-js/) for more information.

## Usage

To run once:

```
npx --yes @flydotio/dockerfile@latest
bunx --bun @flydotio/dockerfile@latest
```

Or install it with your favorite package manager:

```
bun add -d @flydotio/dockerfile
npm install @flydotio/dockerfile --save-dev
pnpm add -D @flydotio/dockerfile
yarn add @flydotio/dockerfile --dev
```

Once installed, you can run and re-run using `npx dockerfile` for Node.js applications or `bunx --bun dockerfile` for Bun applications.

Options are saved between runs into `package.json`. To invert a boolean options, add or remove a no- prefix from the option name.

### Options:

* `--alpine` - use [alpine](https://www.alpinelinux.org/) as base image
* `--build=CMD` - command to be used to build your application.
* `--cache` - use build caching to speed up builds
* `--cmd=CMD` - CMD to use in Dockerfile
* `--defer-build` - may be needed when your build step requires access to secrets that are not available at image build time. Results in larger images and slower deployments.
* `--dev` - include `devDependencies` in the production image.
* `--distroless` - use [distroless](https://github.com/GoogleContainerTools/distroless) base image to reduce image size
* `--entrypoint` - ENTRYPOINT to use in Dockerfile
* `--ignore-scripts` - do not execute any scripts defined in the project `package.json` and its dependencies.
* `--force` - overwrite existing files
* `--legacy-peer-deps` - [ignore peer dependencies](https://docs.npmjs.com/cli/v7/using-npm/config#legacy-peer-deps).
* `--litefs` - configure and enable [litefs](https://fly.io/docs/litefs/).
* `--nginxRoot=DIR` - serve static files from given directory via [nginx](https://www.nginx.com/).
* `--link` - Add [--link](https://docs.docker.com/engine/reference/builder/#copy---link) to COPY statements.  Some tools, including [buildah](https://www.redhat.com/en/topics/containers/what-is-buildah)) or [Buildkit](https://docs.docker.com/build/buildkit/) don't properly support this feature.
* `--port=n` - expose port (default may vary based on framework, but otherwise is `3000`)
* `--swap=n` - allocate swap space.  See [falloc options](https://man7.org/linux/man-pages/man1/fallocate.1.html#OPTIONS) for suffixes
* `--windows` - make Dockerfile work for Windows users that may have set `git config --global core.autocrlf true`.

### Add a package/environment variable/build argument:

Not all of your needs can be determined by scanning your application.  For example, I like to add [vim](https://www.vim.org/) and [procps](https://packages.debian.org/bullseye/procps).

 * `--add package...` - add one or more debian packages
 * `--arg=name:value` - add a [build argument](https://docs.docker.com/engine/reference/builder/#arg)
 * `--env=name:value` - add an environment variable
 * `--remove package...` - remove package from "to be added" list

Args and environment variables can be tailored to a specific build phase by adding `-base`, `-build`, or `-deploy` after the flag name (e.g `--add-build freetds-dev --add-deploy freetds-bin`).  If no such suffix is found, the default for arg is `-base`, and the default for env is `-deploy`.  Removal of an arg or environment variable is done by leaving the value blank (e.g `--env-build=PORT:`).

## Build secrets

Techniques such as static site generation using databases may require access to secrets at build time.  To enable this you will need to _mount_ the secret:

* `--mount-secret=name` - add _name_ to the list of secrets to mount when running the build script
* `--unmount-secret-name` - remove _name_ from the list of secrets to mount when running the build script

See [Secret to expose to the build](https://docs.docker.com/engine/reference/commandline/buildx_build/#secret) for examples on how to pass secrets to a docker build.

## Advanced customization

There may be times where feature detection plus flags just aren't enough. As an example, you may wish to configure and run multiple processes.

* `--instructions=path` - a dockerfile fragment to be inserted into the final document.

Like with environment variables, packages, and build args, `--instructions` can be tailored to a specific build phase by adding `-base`, `-build`, or `-deploy` after the flag name, with the default being `-deploy`.

## Platform specific processing

In addition to creating Dockerfiles and associated artifacts, `dockerfile-node` can run platform specific processing.  At the present time the first and only platform taking advantage of this is naturally fly.io.

If, and only if, `flyctl` is installed, part of the path, and there exists a valid `fly.toml` file in the current directory, dockerfile-node will:

 * configure and create volume(s) for sqlite3
 * set swapfile size if that option is selected
 * attach consul for litefs
 * set secrets for remix and adonis apps
 * initialize git
 * define a staging app if one is mentioned in `.github/workflows/deploy.yml`

## Testing

A single invocation of `npm test` will run all of the tests defined.  Additionally `npm run eslint` will run eslint.

The current integration testing strategy is to run the dockerfile generator against various configurations and compare the generated artifacts with expected results.  `ARG` values in `Dockerfiles` are masked before comparison.

To assist with this process, outputs of tests can be captured automatically.  This is useful when adding new tests and when making a change that affects many tests.  Be sure to inspect the output (e.g., by using `git diff`) before committing.

```
npm run test:capture
```

To run a single test (or tests maching a pattern), run mocha directly with the `grep` option.

```
npx mocha --grep swap
```

Additionally, each the outputs in each test directory can be directly tested to ensure that they can be successfully built by running docker buildx directory passing in the necessary build arguments.  For example:

```
docker buildx build . --build-arg NODE_VERSION=18
```
