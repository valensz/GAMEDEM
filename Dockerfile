# Use a lightweight Nginx image to serve static frontend files
FROM nginx:stable-alpine

# Copy the app content into the default nginx web root
COPY . /usr/share/nginx/html

# Create an entrypoint script to make Nginx listen on the PORT environment variable
RUN echo '#!/bin/sh\n\
PORT=${PORT:-8080}\n\
sed -i "s/listen 80;/listen $PORT;/" /etc/nginx/conf.d/default.conf\n\
exec nginx -g "daemon off;"' > /entrypoint.sh && \
    chmod +x /entrypoint.sh

# Expose the port (Cloud Run will override with PORT env var)
EXPOSE 8080

# Set the entrypoint to handle dynamic port configuration
ENTRYPOINT ["/entrypoint.sh"]
