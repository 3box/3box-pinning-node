# Release Notes

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
