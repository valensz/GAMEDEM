# Use a lightweight Nginx image to serve static frontend files
FROM nginx:stable-alpine

# Copy the app content into the default nginx web root
COPY . /usr/share/nginx/html

# Create a startup script that configures Nginx to listen on PORT environment variable
RUN cat > /entrypoint.sh << 'EOF'
#!/bin/sh
set -e

# Use PORT environment variable or default to 8080
PORT=${PORT:-8080}

# Replace the listen port in the default config
sed -i "s/listen 80;/listen ${PORT};/g" /etc/nginx/conf.d/default.conf
sed -i "s/listen \[:::\]80;/listen [::]:${PORT};/g" /etc/nginx/conf.d/default.conf

# Start Nginx in foreground mode
exec nginx -g "daemon off;"
EOF

RUN chmod +x /entrypoint.sh

# Expose port 8080 as the default (will be overridden by Cloud Run PORT env var)
EXPOSE 8080

# Set the entrypoint to handle dynamic port configuration
ENTRYPOINT ["/entrypoint.sh"]
