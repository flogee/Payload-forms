import type { Definition } from './types'

// Fictional structural fixture; no research questionnaire or respondent data.
export const sample: Definition = {
  "version": "sample-v1",
  "introduction": [
    "A fictional questionnaire for exploring the application. Use invented test data only.",
    "Every question is optional. This example does not represent a research instrument."
  ],
  "sections": [
    {
      "id": "organisation",
      "title": "Example section 1",
      "questions": [
        {
          "id": "F01_unit",
          "block": "F01",
          "label": "Example 1.1: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            }
          ]
        },
        {
          "id": "F01_name",
          "block": "F01",
          "label": "Example 1.2: text",
          "kind": "text",
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F02_role",
          "block": "F02",
          "label": "Example 1.3: multiple",
          "kind": "multiple",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            }
          ]
        },
        {
          "id": "F02_knowledge",
          "block": "F02",
          "label": "Example 1.4: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            }
          ]
        },
        {
          "id": "F03_legal",
          "block": "F03",
          "label": "Example 1.5: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ],
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F04_year",
          "block": "F04",
          "label": "Example 1.6: count",
          "kind": "count",
          "min": 1,
          "max": 2026,
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F04_country",
          "block": "F04",
          "label": "Example 1.7: text",
          "kind": "text"
        },
        {
          "id": "F04_region",
          "block": "F04",
          "label": "Example 1.8: text",
          "kind": "text"
        },
        {
          "id": "F04_place",
          "block": "F04",
          "label": "Example 1.9: text",
          "kind": "text",
          "optional": true
        },
        {
          "id": "F04_sites",
          "block": "F04",
          "label": "Example 1.10: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        },
        {
          "id": "F05_field",
          "block": "F05",
          "label": "Example 1.11: multiple",
          "kind": "multiple",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "6",
              "label": "Option 6"
            },
            {
              "value": "7",
              "label": "Option 7"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            }
          ]
        },
        {
          "id": "F06_people",
          "block": "F06",
          "label": "Example 1.12: counts",
          "kind": "counts",
          "allowNA": true,
          "rows": [
            {
              "key": "r1",
              "label": "Item 1"
            },
            {
              "key": "r2",
              "label": "Item 2"
            },
            {
              "key": "r3",
              "label": "Item 3"
            },
            {
              "key": "r4",
              "label": "Item 4"
            }
          ],
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F07_structure",
          "block": "F07",
          "label": "Example 1.13: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure"
            }
          ]
        },
        {
          "id": "F07_method",
          "block": "F07",
          "label": "Example 1.14: text",
          "kind": "text",
          "optional": true
        }
      ]
    },
    {
      "id": "entscheidungen",
      "title": "Example section 2",
      "questions": [
        {
          "id": "F08_count",
          "block": "F08",
          "label": "Example 2.1: count",
          "kind": "count"
        },
        {
          "id": "F08_committees",
          "block": "F08",
          "label": "Example 2.2: committees",
          "kind": "committees",
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F08_period",
          "block": "F08",
          "label": "Example 2.3: text",
          "kind": "text",
          "optional": true
        },
        {
          "id": "F09_individual",
          "block": "F09",
          "label": "Example 2.4: multiple",
          "kind": "multiple",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "none",
              "label": "None of these",
              "exclusive": true
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        },
        {
          "id": "F10_method",
          "block": "F10",
          "label": "Example 2.5: multiple",
          "kind": "multiple",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        },
        {
          "id": "F10_topics",
          "block": "F10",
          "label": "Example 2.6: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        }
      ]
    },
    {
      "id": "praxis",
      "title": "Example section 3",
      "questions": [
        {
          "id": "F11_strengths",
          "block": "F11",
          "label": "Example 3.1: textarea",
          "kind": "textarea",
          "optional": true
        },
        {
          "id": "F12_gaps",
          "block": "F12",
          "label": "Example 3.2: textarea",
          "kind": "textarea",
          "optional": true,
          "help": "Fictional example; do not enter personal or confidential information."
        }
      ]
    },
    {
      "id": "dokumentation",
      "title": "Example section 4",
      "questions": [
        {
          "id": "F13_storage",
          "block": "F13",
          "label": "Example 4.1: multiple",
          "kind": "multiple",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "6",
              "label": "Option 6"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        },
        {
          "id": "F13_logbook",
          "block": "F13",
          "label": "Example 4.2: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        },
        {
          "id": "F14_roles",
          "block": "F14",
          "label": "Example 4.3: matrix",
          "kind": "matrix",
          "rows": [
            {
              "key": "r1",
              "label": "Item 1"
            },
            {
              "key": "r2",
              "label": "Item 2"
            },
            {
              "key": "r3",
              "label": "Item 3"
            },
            {
              "key": "r4",
              "label": "Item 4"
            },
            {
              "key": "r5",
              "label": "Item 5"
            },
            {
              "key": "r6",
              "label": "Item 6"
            },
            {
              "key": "r7",
              "label": "Item 7"
            }
          ],
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            }
          ],
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F15_minutes",
          "block": "F15",
          "label": "Example 4.4: text",
          "kind": "text",
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F15_roles",
          "block": "F15",
          "label": "Example 4.5: text",
          "kind": "text"
        },
        {
          "id": "F15_review",
          "block": "F15",
          "label": "Example 4.6: text",
          "kind": "text"
        },
        {
          "id": "F16_processes",
          "block": "F16",
          "label": "Example 4.7: matrix",
          "kind": "matrix",
          "rows": [
            {
              "key": "r1",
              "label": "Item 1"
            },
            {
              "key": "r2",
              "label": "Item 2"
            },
            {
              "key": "r3",
              "label": "Item 3"
            },
            {
              "key": "r4",
              "label": "Item 4"
            },
            {
              "key": "r5",
              "label": "Item 5"
            },
            {
              "key": "r6",
              "label": "Item 6"
            }
          ],
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            }
          ]
        }
      ]
    },
    {
      "id": "transparenz",
      "title": "Example section 5",
      "questions": [
        {
          "id": "F17_decisions",
          "block": "F17",
          "label": "Example 5.1: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "6",
              "label": "Option 6"
            },
            {
              "value": "7",
              "label": "Option 7"
            },
            {
              "value": "8",
              "label": "Option 8"
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ],
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F17_minutes",
          "block": "F17",
          "label": "Example 5.2: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "6",
              "label": "Option 6"
            },
            {
              "value": "7",
              "label": "Option 7"
            },
            {
              "value": "8",
              "label": "Option 8"
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ],
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F17_privacy",
          "block": "F17",
          "label": "Example 5.3: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ],
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F17_communication",
          "block": "F17",
          "label": "Example 5.4: multiple",
          "kind": "multiple",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "none",
              "label": "None of these",
              "exclusive": true
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        },
        {
          "id": "F18_lifecycle",
          "block": "F18",
          "label": "Example 5.5: matrix",
          "kind": "matrix",
          "rows": [
            {
              "key": "r1",
              "label": "Item 1"
            },
            {
              "key": "r2",
              "label": "Item 2"
            },
            {
              "key": "r3",
              "label": "Item 3"
            },
            {
              "key": "r4",
              "label": "Item 4"
            },
            {
              "key": "r5",
              "label": "Item 5"
            },
            {
              "key": "r6",
              "label": "Item 6"
            }
          ],
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "6",
              "label": "Option 6"
            },
            {
              "value": "7",
              "label": "Option 7"
            }
          ]
        },
        {
          "id": "F19_dates",
          "block": "F19",
          "label": "Example 5.6: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        },
        {
          "id": "F19_reminders",
          "block": "F19",
          "label": "Example 5.7: multiple",
          "kind": "multiple",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "none",
              "label": "None of these",
              "exclusive": true
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ],
          "showIf": {
            "field": "F19_dates",
            "values": [
              "1",
              "2"
            ]
          }
        },
        {
          "id": "F19_adhoc",
          "block": "F19",
          "label": "Example 5.8: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ],
          "showIf": {
            "field": "F19_dates",
            "values": [
              "3"
            ]
          },
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F20_owner",
          "block": "F20",
          "label": "Example 5.9: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "other",
              "label": "Other",
              "exclusive": false
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        },
        {
          "id": "F20_role",
          "block": "F20",
          "label": "Example 5.10: text",
          "kind": "text",
          "optional": true
        },
        {
          "id": "F20_backup",
          "block": "F20",
          "label": "Example 5.11: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "unknown",
              "label": "Not sure",
              "exclusive": true
            }
          ]
        }
      ]
    },
    {
      "id": "bewertung",
      "title": "Example section 6",
      "questions": [
        {
          "id": "F21_rating",
          "block": "F21",
          "label": "Example 6.1: matrix",
          "kind": "matrix",
          "rows": [
            {
              "key": "r1",
              "label": "Item 1"
            },
            {
              "key": "r2",
              "label": "Item 2"
            },
            {
              "key": "r3",
              "label": "Item 3"
            },
            {
              "key": "r4",
              "label": "Item 4"
            },
            {
              "key": "r5",
              "label": "Item 5"
            },
            {
              "key": "r6",
              "label": "Item 6"
            }
          ],
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "6",
              "label": "Option 6"
            },
            {
              "value": "7",
              "label": "Option 7"
            }
          ],
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F22_frequency",
          "block": "F22",
          "label": "Example 6.2: matrix",
          "kind": "matrix",
          "rows": [
            {
              "key": "r1",
              "label": "Item 1"
            },
            {
              "key": "r2",
              "label": "Item 2"
            },
            {
              "key": "r3",
              "label": "Item 3"
            },
            {
              "key": "r4",
              "label": "Item 4"
            }
          ],
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "6",
              "label": "Option 6"
            }
          ]
        },
        {
          "id": "F23_satisfaction",
          "block": "F23",
          "label": "Example 6.3: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            },
            {
              "value": "4",
              "label": "Option 4"
            },
            {
              "value": "5",
              "label": "Option 5"
            },
            {
              "value": "6",
              "label": "Option 6"
            }
          ]
        },
        {
          "id": "F24_improvement",
          "block": "F24",
          "label": "Example 6.4: textarea",
          "kind": "textarea",
          "optional": true,
          "help": "Fictional example; do not enter personal or confidential information."
        },
        {
          "id": "F25_interview",
          "block": "F25",
          "label": "Example 6.5: single",
          "kind": "single",
          "options": [
            {
              "value": "1",
              "label": "Option 1"
            },
            {
              "value": "2",
              "label": "Option 2"
            },
            {
              "value": "3",
              "label": "Option 3"
            }
          ],
          "help": "Fictional example; do not enter personal or confidential information."
        }
      ]
    }
  ]
}
