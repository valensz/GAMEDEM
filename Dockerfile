# Use a lightweight Nginx image to serve static frontend files
FROM nginx:stable-alpine

# Copy the app content into the default nginx web root
COPY . /usr/share/nginx/html

# Expose port 80 for the web server
EXPOSE 80

# Start Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
