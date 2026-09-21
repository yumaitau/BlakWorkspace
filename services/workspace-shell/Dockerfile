FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY shell.js shell.css apps.json tokens.json logo.svg projects-logo.svg login-background.png /usr/share/nginx/html/_blak/
COPY signout.html signout.js launch.html launch.js /usr/share/nginx/html/_blak/
COPY fonts.css /usr/share/nginx/html/_blak/
COPY fonts/ /usr/share/nginx/html/_blak/fonts/
