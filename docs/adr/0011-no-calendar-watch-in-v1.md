# No Calendar → Attio Projection in v1

v1 writes Attio → Calendar only. Bindings and `extendedProperties.private` are the hook for later reverse Projection. Google watch channels expire in seven days, POST no event body, and `syncToken` cannot filter by our private property. Implementing watch now would be renewal and quota machinery with no writer. Implementing reverse Projection now is out of scope.
