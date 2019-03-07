FROM node:10
WORKDIR /3box-pinning-server
COPY package.json /3box-pinning-server/package.json
ADD  package-lock.json /3box-pinning-server/package-lock.json
RUN npm install
COPY src /3box-pinning-server/src
EXPOSE  8081 4002 4003 5002 9090
CMD npm run start
