# Use a lightweight Nginx image to serve static frontend files
FROM nginx:stable-alpine

# Copy the app content into the default nginx web root
COPY . /usr/share/nginx/html

# Use the container's default web port 80
ENV PORT=80
EXPOSE 80

# Start Nginx in the foreground on port 80
CMD ["nginx", "-g", "daemon off;"]
