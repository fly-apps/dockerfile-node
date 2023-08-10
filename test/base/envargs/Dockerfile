# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=xxx
FROM node:${NODE_VERSION}-slim as base

# Base arguments 
ARG A1=xxx
    
LABEL fly_launch_runtime="Node.js"

# Node.js app lives here
WORKDIR /app

# Build arguments 
ARG A2=xxx

# Set production environment
ENV E1="V1" \
    NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base as build

ENV E2="V2"

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install -y build-essential pkg-config python-is-python3

# Install node modules
COPY --link package-lock.json package.json ./
RUN npm ci --include=dev

# Copy application code
COPY --link . .

# Build application
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev


# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app /app

# Deploy arguments 
ARG A3=xxx
            
# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
ENV E3="V3"
CMD [ "npm", "run", "start" ]
