# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=xxx
FROM node:${NODE_VERSION}-slim as base

LABEL fly_launch_runtime="Meteor"

# Meteor app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base as build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential curl g++ make node-gyp pkg-config python-is-python3 python3-pip

# Copy the .meteor/release file to the container
COPY .meteor/release /home/meteor/.meteor/release

ENV METEOR_ALLOW_SUPERUSER=1

# Extract the Meteor release version and install Meteor
RUN RELEASE=$(awk -F'@' '{print $2}' /home/meteor/.meteor/release) && curl https://install.meteor.com/\?release\=$RELEASE | sh
# Install node modules
COPY package-lock.json package.json ./
RUN npm ci

RUN meteor npm install
# Copy application code
COPY . .
RUN meteor build --server-only --directory bundle

# https://github.com/meteor/meteor/issues/12932
RUN chmod 777 bundle/bundle/programs/server/npm-shrinkwrap.json

RUN cd bundle/bundle/programs/server && meteor npm install


# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app/bundle/bundle /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "node", "main.js" ]
