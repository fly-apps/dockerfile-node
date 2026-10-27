# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=xxx
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Astro"

# Astro app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install node modules
COPY package-lock.json package.json ./
RUN npm ci --include=dev

# Copy application code
COPY . .

# Build application
RUN npm run build


# Final stage for app image
FROM nginx

# Copy built application
COPY --from=build /app/build /usr/share/nginx/html/docs

# Serve the site, with its own 404 page and relative redirects
COPY <<-"EOF" /etc/nginx/conf.d/default.conf
server {
  listen 80;
  listen [::]:80;
  root /usr/share/nginx/html;
  absolute_redirect off;
  error_page 404 /docs/404.html;
}
EOF

# Start the server by default, this can be overwritten at runtime
EXPOSE 80
CMD [ "/usr/sbin/nginx", "-g", "daemon off;" ]
