# Release Notes

### v.14.5 - 2020-06-19
* chore: up ipfs 0.46.0

### v.14.4 - 2020-06-18
* chore: up aws, increase mem prod, temp logs

## v.14.3 - 2020-06-17
* build: increase node mem prod docker image

## v.14.2 - 2020-06-03
* core: update to `ipfs@0.44`

## v.14.1 - 2020-05-25
* chore: increase max number of swarm connections from 500 to 1500

## v1.14.0 - 2020-05-01

* chore: upgrade did-resolver and did-jwt libraries
* feat: add smoke tests to CI

## v1.13.0 - 2020-03-12
* feat: add CODE_VERSION to dockerfile, circle ci image build step, and logger
* feat: add bunyan logger
* refactor: move ipfs init into main module, use ipfs-http-client instead of ipfs if IPFS_API_URL env var is set

## v1.12.0 - 2019-01-28
* feat: upgrade `orbit-db` to v0.23.1
* feat: upgrade `ipfs` to v0.40.0
* feat: add parameter for only pinning content for specified root DIDs
* feat: add parameter for only pinning content for specified space names
* feat: add parameter for silently pinning content

## v1.11.0 - 2019-01-15
Includes performance improvements that will allow syncing to start sooner on client
and for onSync done to resolve more quickly.

* feat: cache has entries and send on message
* feat: send heads on connect, with orbit fix, remove wait

## v1.10.0 - 2019-01-08
* feat: allow additional S3 client options to be configured for endpoint, addressing style and signature version
* feat: allow pinning room channel to be configured

## v1.9.1 - 2019-12-18
* fix: cache key write for db names with slashes, ie threads ac db

## v1.9.0 - 2019-12-12
* feat: up orbit-db v0.22.1, cache change, performance up

## v1.8.0 - 2019-12-10
* feat: remove profile API functionality

## v1.7.2 - 2019-12-02
* fix: pin auth-data objects from rootstore

## v1.7.1 - 2019-10-10
* feat: dedicated healthcheck endpoint

## v1.7.0 - 2019-09-20
* feat: multi node support with internal message layer

## v1.6.4 - 2019-09-18
* fix: wait to consumer/exchange heads until store ready (local orbitdb fix)

## v1.6.3 - 2019-09-10
* fix: return author on getThread

## v1.6.2 - 2019-08-22
* fix: correctly calculate HAS_ENTRIES response

## v1.6.1 - 2019-08-06
* feat: origin api metrics, did hash metrics, unique spaces, metric properties

## v1.6.0 - 2019-07-12
* feat: pin address-link entries from root-store
* feat: getConfig now returns address-links

## v1.5.1 - 2019-06-19
* feat: getProfile with 3ID
* fix: getThread don't hang, return error when missing or invalid args

## v1.5.0 - 2019-06-11
* feat: update orbitdb and ipfs
* feat: add 3ID
* feat: add support for moderator threads, and thread api changes
* feat: add getConfig api endpoint

## v1.4.2 - 2019-05-06
* Fix: Use correct timestamp format.

## v1.4.1 - 2019-04-27
* Fix/Performance: Cache liveness and fix, rewrite cache on change instead of invalidate

## v1.4.0 - 2019-04-25
* Feature: optional S3 IPFS Repo
* Feature: optional Redis OribtDB cache
* Feature: optional API only optimization
* Fix: openBox concurrency issues
* Build: dockerfile
* Build: container based CI/CD pipeline

## v1.3.0 - 2019-04-12
* Feature: Add the ability to query metadata in the profile and space APIs
* Fix: Automatically pin DIDs that are sent along when opening a DB
* Fix: Don't break when opening empty threads
* Fix: Make getProfile API more resilient to errors

## v1.2.0 - 2019-03-28
* Feature: Pinning for threads
* Feature: Query by DID in getProfile and getSpace

## v1.1.1 - 2019-03-15
* More granular invalidation of cache
* Fix bug where space names where normalized when they shouldn't be


## v1.1.0 - 2019-03-12
* add support for `space` and `list-space` REST endpoints
* fix bug with malformed `PIN_DB` messages

## v1.0.1 - 2019-01-29
* CI/CD on develop/master
* Memory measurement for analytics
* Automatic restart when a memory threshold has been reached
* Fix: openDB responds only per db
