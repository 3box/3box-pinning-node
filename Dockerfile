FROM node:10

WORKDIR /3box-pinning-server

COPY package.json package-lock.json ./
RUN npm install

COPY src ./src

EXPOSE  8081 4002 4003 5002 9090

CMD npm run start
