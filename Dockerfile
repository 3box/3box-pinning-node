FROM node:12.18.1

ARG CODE_VERSION="00000"

ENV CODE_VERSION=${CODE_VERSION}

WORKDIR /3box-pinning-server

COPY package.json package-lock.json ./
RUN npm install

COPY src ./src

EXPOSE 8081 4002 4003 5002 9090 9229

CMD npm run start:prod
