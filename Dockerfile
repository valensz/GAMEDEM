FROM node:20-bookworm-slim

# Set the working directory
WORKDIR /app

# Install native build dependencies for better-sqlite3 and canvas
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        pkg-config \
        libcairo2-dev \
        libpango1.0-dev \
        libjpeg-dev \
        libgif-dev \
        librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the full project source into the container
COPY . ./

# Expose the listening port and start the app
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
