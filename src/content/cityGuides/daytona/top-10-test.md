---
city:     "daytona"
title:    "Top 10 Test Guide (Map + Font Diagnostic)"
category: "Test"
intro:    "This is a diagnostic page to verify the interactive map, 20px body font, and NOOGA-style sidebar newsletter are all working correctly. The map should appear directly below this intro text."
author:   "Charles King"
role:     "Newsletter Editor"
pubDate:  "2026-03-09"

map_locations:
  - label:   "Test Spot Alpha"
    address: "123 Main St, Daytona Beach, FL 32114"
    lat:     29.2108
    lng:     -81.0232
  - label:   "Test Spot Beta"
    address: "456 Ocean Ave, Daytona Beach, FL 32118"
    lat:     29.2250
    lng:     -81.0075
  - label:   "Test Spot Gamma"
    address: "789 Ridgewood Ave, South Daytona, FL 32119"
    lat:     29.1720
    lng:     -81.0030

items:
  - rank: 1
    tag:    "Category A"
    title:  "Test Item One"
    body:   "This paragraph is rendered via the .iBody class in the template. It should display at 20px / 1.65 line-height on desktop (17px on mobile). If this text looks noticeably larger than normal body copy, the font size update is working correctly."
    img:    ""
    imgAlt: ""
    href:   ""

  - rank: 2
    tag:    "Category B"
    title:  "Test Item Two"
    body:   "Another .iBody paragraph. The three map pins above should be visible before this list starts. Pin popups should show label and address when clicked."
    img:    ""
    imgAlt: ""
    href:   ""

  - rank: 3
    tag:    "Category C"
    title:  "Test Item Three"
    body:   "This is item three. The sidebar to the right should show the NOOGA-style newsletter block: large yellow card with white email input and a black Sign Up button."
    img:    ""
    imgAlt: ""
    href:   ""

  - rank: 4
    tag:    "Category D"
    title:  "Test Item Four"
    body:   "This item appears after the load-more boundary. A sponsor card may appear between items 3 and 4 if a global sponsor is active."
    img:    ""
    imgAlt: ""
    href:   ""

  - rank: 5
    tag:    "Category E"
    title:  "Test Item Five"
    body:   "Checking that the load-more button reveals items 4 through 10 when clicked. JavaScript should toggle the hidden list without a page reload."
    img:    ""
    imgAlt: ""
    href:   ""

  - rank: 6
    tag:    "Category F"
    title:  "Test Item Six"
    body:   "Font size diagnostic: compare this text against the guideNote section below. The guideNote renders at 15px / 1.7; this .iBody should be clearly larger at 20px / 1.65."
    img:    ""
    imgAlt: ""
    href:   ""

  - rank: 7
    tag:    "Category G"
    title:  "Test Item Seven"
    body:   "Breadcrumb check: the navigation bar above the map should read Home › Guides › Top 10 Test Guide with yellow clickable links."
    img:    ""
    imgAlt: ""
    href:   ""

  - rank: 8
    tag:    "Category H"
    title:  "Test Item Eight"
    body:   "Sticky sidebar check: scroll down the page and verify the newsletter card in the right gutter stays fixed in view as you move through items 8, 9, and 10."
    img:    ""
    imgAlt: ""
    href:   ""

  - rank: 9
    tag:    "Category I"
    title:  "Test Item Nine"
    body:   "Map tile check: the CartoDB Positron basemap should be visible (light grey streets). If you see only yellow pins on a blank white rectangle, the tile layer failed to load — likely a CDN or CORS issue."
    img:    ""
    imgAlt: ""
    href:   ""

  - rank: 10
    tag:    "Category J"
    title:  "Test Item Ten"
    body:   "Final item. If all 10 items are visible and readable, both the load-more JavaScript and the 20px font size are confirmed working. This guide can be deleted once diagnostics pass."
    img:    ""
    imgAlt: ""
    href:   ""
---

This section is the **markdown body** — rendered inside `.guideNote.prose` at the bottom of the list. It intentionally uses a smaller 15px font to distinguish it from the `.iBody` item paragraphs above. Numbered items added here for the body-rendering test:

1. Body markdown item one
2. Body markdown item two
3. Body markdown item three
4. Body markdown item four
5. Body markdown item five
6. Body markdown item six
7. Body markdown item seven
8. Body markdown item eight
9. Body markdown item nine
10. Body markdown item ten
