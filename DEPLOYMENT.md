# Pinning server deployment

The pinning server is a node.js process that is running using a the PM2 process manager.

## Deployment

Server deployment is manual at the moment. Continuous deployment is gonna be added in the future.

To deploy it you should enter `ssh` into the machine.
Inside the home folder you need to execute

`./deploy.sh`

And that's it. The server is redeployed again.

To ensure the server is running correctly, with the command

`pm2 ls`

You should see an output like this:

| App name  | id  | version  | mode  | pid  | status  | restart  | uptime  | cpu  | mem  | user  |  watching |
|---|---|---|---|---|---|---|---|---|---|---|---|
| server  |  0 | 1.0.0  | fork  | 11864  | online  | 2  |  3m | 0.6% | 90.7 MB   |  ec2-user  | disabled |

To inspect logs and trace possible bugs/errors, you just need to type the command:

`pm2 logs`