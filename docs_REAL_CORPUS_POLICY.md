# Real photo corpus policy v2

## Source choice
We use Openverse as the discovery API because it is specifically designed to index openly licensed media and supports search filters for `category=photograph` and license filters. The project retains source/creator/license/landing URL metadata for every selected image.

## Allowed license filters
Only:
- CC BY (`by`)
- CC0 (`cc0`)
- Public Domain Mark (`pdm`)

We intentionally exclude NC, ND, sampling and other restricted licenses from the public MVP.

## Verification rule
Openverse itself warns that it cannot guarantee the accuracy of license information. Every record therefore stores the exact source/landing URL and license URL, and the final manifest is to be spot-checked against the upstream source before public launch.

## Image handling
Images are downloaded from the source result, resized/compressed to a web-friendly JPEG, and marked as modified for web delivery. This is compatible with CC BY when attribution and license terms are preserved; CC0/PDM have no attribution requirement, but we still retain attribution for provenance.

## No personal photos
No real user's private Google Photos library is used.

## No synthetic images
The production demo corpus must contain real photographs; benchmark annotations are our evaluation labels and are not presented as original camera metadata.

## Provenance shown in product
A candidate's attribution/source/license is available from the candidate information UI and a dedicated attribution page.
