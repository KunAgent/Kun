## Parameter Value Conventions

* The `adjustments` parameters are described in the order and quantity defined by OOXML
* Values generally range over [0, 100000], representing a percentage (100000 = 100%)
* Angle parameters are in units of 1/60000 of a degree in OOXML; conversion formula: `OOXML value = degrees × 60000` (for example, `16200000` = 270°)
* The parameter array must remain complete (intermediate values cannot be omitted), or be omitted entirely to use default values
* `-` indicates the shape has no adjustable parameters

---

## Basic Shapes

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| rect | Rectangle | - | - |
| roundRect | Rounded rectangle | [corner radius] | [16667] |
| ellipse | Ellipse | - | - |
| triangle | Triangle | [horizontal position of apex] | [50000] |
| rtTriangle | Right triangle | - | - |
| parallelogram | Parallelogram | [slant offset] | [25000] |
| trapezoid | Trapezoid | [top edge inset] | [25000] |
| nonIsoscelesTrapezoid | Non-isosceles trapezoid | [left offset, right offset] | [25000, 25000] |
| diamond | Diamond | - | - |
| pentagon | Regular pentagon | [horizontal factor, vertical factor] | [105146, 110557] |
| hexagon | Hexagon | [inset offset, vertical factor] | [25000, 115470] |
| heptagon | Heptagon | [horizontal factor, vertical factor] | [102572, 105210] |
| octagon | Octagon | [corner cut size] | [29289] |
| decagon | Decagon | [vertical factor] | [105146] |
| dodecagon | Dodecagon | - | - |
| plus | Plus sign | [arm width ratio] | [25000] |
| homePlate | Five-sided arrow | [arrowhead tip offset] | [50000] |
| chevron | V-shaped arrow | [V tip offset] | [50000] |
| pie | Pie | [start angle°, end angle°] | [0, 16200000] |
| pieWedge | Pie wedge | - | - |
| arc | Arc | [start angle°, end angle°] | [16200000, 0] |
| chord | Chord | [start angle°, end angle°] | [2700000, 16200000] |
| blockArc | Block arc | [start angle°, end angle°, thickness] | [10800000, 0, 25000] |
| teardrop | Teardrop | [tail extension ratio] | [100000] |
| frame | Frame | [border thickness] | [12500] |
| halfFrame | Half frame | [horizontal thickness, vertical thickness] | [33333, 33333] |
| corner | Corner | [horizontal thickness, vertical thickness] | [50000, 50000] |
| diagStripe | Diagonal stripe | [stripe width] | [50000] |
| foldedCorner | Folded corner | - | - |
| donut | Donut | [ring width ratio] | [25000] |
| noSmoking | Prohibition symbol | [slash width] | [18750] |
| heart | Heart | - | - |
| lightningBolt | Lightning bolt | - | - |
| sun | Sun | [inner radius ratio of rays] | [25000] |
| moon | Moon | [crescent width] | [50000] |
| cloud | Cloud | - | - |
| smileyFace | Smiley face | [mouth curvature] | [4653] |
| bevel | Bevel | [bevel width] | [12500] |
| can | Cylinder | [elliptical lid height] | [25000] |
| cube | Cube | [perspective depth] | [25000] |
| funnel | Funnel | - | - |
| gear6 | Six-tooth gear | [tooth height, tooth width] | [15000, 3526] |
| gear9 | Nine-tooth gear | [tooth height, tooth width] | [10000, 1763] |
| plaque | Plaque | [corner radius] | [16667] |
| doubleWave | Double wave | [wave amplitude, horizontal offset] | [6250, 0] |
| wave | Wave | [wave amplitude, horizontal offset] | [12500, 0] |
| lineInv | Inverse line | - | - |

## Rectangle Variants

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| round1Rect | Single-rounded-corner rectangle | [corner radius] | [16667] |
| round2DiagRect | Rectangle with two diagonally rounded corners | [corner 1 radius, corner 2 radius] | [16667, 0] |
| round2SameRect | Rectangle with two same-side rounded corners | [top corner radius, bottom corner radius] | [16667, 0] |
| snip1Rect | Single-cut-corner rectangle | [corner cut size] | [16667] |
| snip2DiagRect | Rectangle with two diagonally cut corners | [corner 1 cut size, corner 2 cut size] | [0, 16667] |
| snip2SameRect | Rectangle with two same-side cut corners | [top cut size, bottom cut size] | [16667, 0] |
| snipRoundRect | Rectangle with one rounded and one cut corner | [corner radius, corner cut size] | [16667, 16667] |

## Stars and Bursts

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| star4 | 4-point star | [inner radius ratio] | [12500] |
| star5 | 5-point star | [inner radius ratio, horizontal factor, vertical factor] | [19098, 105146, 110557] |
| star6 | 6-point star | [inner radius ratio, horizontal factor] | [28868, 115470] |
| star7 | 7-point star | [inner radius ratio, horizontal factor, vertical factor] | [34601, 102572, 105210] |
| star8 | 8-point star | [inner radius ratio] | [37500] |
| star10 | 10-point star | [inner radius ratio, horizontal factor] | [42533, 105146] |
| star12 | 12-point star | [inner radius ratio] | [37500] |
| star16 | 16-point star | [inner radius ratio] | [37500] |
| star24 | 24-point star | [inner radius ratio] | [37500] |
| star32 | 32-point star | [inner radius ratio] | [37500] |
| irregularSeal1 | Burst 1 | - | - |
| irregularSeal2 | Burst 2 | - | - |

## Arrow Shapes

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| rightArrow | Right arrow | [shaft width, arrowhead length] | [50000, 50000] |
| leftArrow | Left arrow | [shaft width, arrowhead length] | [50000, 50000] |
| upArrow | Up arrow | [shaft width, arrowhead length] | [50000, 50000] |
| downArrow | Down arrow | [shaft width, arrowhead length] | [50000, 50000] |
| leftRightArrow | Left-right arrow | [shaft width, arrowhead length] | [50000, 50000] |
| upDownArrow | Up-down arrow | [shaft width, up arrowhead length, shaft width, down arrowhead length] | [50000, 50000, 50000, 50000] |
| quadArrow | Quad arrow | [shaft width, arrowhead width, arrowhead length] | [22500, 22500, 22500] |
| leftRightUpArrow | Left-right-up arrow | [shaft width, arrowhead width, arrowhead length] | [25000, 25000, 25000] |
| leftUpArrow | Left-up arrow | [shaft width, arrowhead width, arrowhead length] | [25000, 25000, 25000] |
| bentArrow | Bent arrow | [shaft width, arrowhead width, arrowhead length, bend position] | [25000, 25000, 25000, 43750] |
| bentUpArrow | Bent up arrow | [shaft width, arrowhead width, arrowhead length] | [25000, 25000, 25000] |
| uturnArrow | U-turn arrow | [shaft width, arrowhead width, arrowhead length, bend radius, shaft length] | [25000, 25000, 25000, 43750, 75000] |
| circularArrow | Circular arrow | [arrowhead width, start angle°, end angle°, arc angle°, arrow tip width] | [12500, 1142319, 20457681, 10800000, 12500] |
| leftCircularArrow | Left circular arrow | [arrowhead width, start angle°, end angle°, arc angle°, arrow tip width] | [12500, -1142319, 1142319, 10800000, 12500] |
| leftRightCircularArrow | Left-right circular arrow | [arrowhead width, start angle°, end angle°, arc angle°, arrow tip width] | [12500, 1142319, 20457681, 11942319, 12500] |
| curvedRightArrow | Curved right arrow | [arrowhead width, curvature, arrowhead length] | [25000, 50000, 25000] |
| curvedLeftArrow | Curved left arrow | [arrowhead width, curvature, arrowhead length] | [25000, 50000, 25000] |
| curvedUpArrow | Curved up arrow | [arrowhead width, curvature, arrowhead length] | [25000, 50000, 25000] |
| curvedDownArrow | Curved down arrow | [arrowhead width, curvature, arrowhead length] | [25000, 50000, 25000] |
| stripedRightArrow | Striped right arrow | [shaft width, arrowhead length] | [50000, 50000] |
| notchedRightArrow | Notched right arrow | [shaft width, arrowhead length] | [50000, 50000] |
| swooshArrow | Swoosh arrow | [tail width, arrowhead length] | [25000, 16667] |

## Arrow Callouts

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| rightArrowCallout | Right arrow callout | [shaft width, arrowhead width, arrowhead length, box width] | [25000, 25000, 25000, 64977] |
| leftArrowCallout | Left arrow callout | [shaft width, arrowhead width, arrowhead length, box width] | [25000, 25000, 25000, 64977] |
| upArrowCallout | Up arrow callout | [shaft width, arrowhead width, arrowhead length, box height] | [25000, 25000, 25000, 64977] |
| downArrowCallout | Down arrow callout | [shaft width, arrowhead width, arrowhead length, box height] | [25000, 25000, 25000, 64977] |
| leftRightArrowCallout | Left-right arrow callout | [shaft width, arrowhead width, arrowhead length, box width] | [25000, 25000, 25000, 48123] |
| upDownArrowCallout | Up-down arrow callout | [shaft width, arrowhead width, arrowhead length, box height] | [25000, 25000, 25000, 48123] |
| quadArrowCallout | Quad arrow callout | [shaft width, arrowhead width, arrowhead length, box size] | [18515, 18515, 18515, 48123] |

## Callouts

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| wedgeRectCallout | Rectangle callout | [tip X offset, tip Y offset] | [-20833, 62500] |
| wedgeRoundRectCallout | Rounded rectangle callout | [tip X offset, tip Y offset, corner radius] | [-20833, 62500, 16667] |
| wedgeEllipseCallout | Ellipse callout | [tip X offset, tip Y offset] | [-20833, 62500] |
| cloudCallout | Cloud callout | [tip X offset, tip Y offset] | [-20833, 62500] |
| borderCallout1 | Line callout 1 | [callout line Y1, X1, Y2, X2] | [18750, -8333, 112500, -38333] |
| borderCallout2 | Line callout 2 | [line Y1, X1, knee point Y, X, end point Y, X] | [18750, -8333, 18750, -16667, 112500, -46667] |
| borderCallout3 | Line callout 3 | [line Y1, X1, knee point 1 Y, X, knee point 2 Y, X, end point Y, X] | [18750, -8333, 18750, -16667, 100000, -16667, 112963, -8333] |
| accentCallout1 | Accent line callout 1 | Same as borderCallout1 | [18750, -8333, 112500, -38333] |
| accentCallout2 | Accent line callout 2 | Same as borderCallout2 | [18750, -8333, 18750, -16667, 112500, -46667] |
| accentCallout3 | Accent line callout 3 | Same as borderCallout3 | [18750, -8333, 18750, -16667, 100000, -16667, 112963, -8333] |
| accentBorderCallout1 | Bordered accent line callout 1 | Same as borderCallout1 | [18750, -8333, 112500, -38333] |
| accentBorderCallout2 | Bordered accent line callout 2 | Same as borderCallout2 | [18750, -8333, 18750, -16667, 112500, -46667] |
| accentBorderCallout3 | Bordered accent line callout 3 | Same as borderCallout3 | [18750, -8333, 18750, -16667, 100000, -16667, 112963, -8333] |
| callout1 | Borderless callout 1 | Same as borderCallout1 | [18750, -8333, 112500, -38333] |
| callout2 | Borderless callout 2 | Same as borderCallout2 | [18750, -8333, 18750, -16667, 112500, -46667] |
| callout3 | Borderless callout 3 | Same as borderCallout3 | [18750, -8333, 18750, -16667, 100000, -16667, 112963, -8333] |

> **Callout tip offset note**: The X/Y offset values of callout shapes use the shape center as the origin, in units of a percentage of the shape's width/height. Negative values mean the tip is on the left side/above the shape.

## Brackets and Braces

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| leftBrace | Left brace | [curvature, middle point position] | [8333, 50000] |
| rightBrace | Right brace | [curvature, middle point position] | [8333, 50000] |
| leftBracket | Left bracket | [curvature] | [8333] |
| rightBracket | Right bracket | [curvature] | [8333] |
| bracePair | Brace pair | [curvature] | [8333] |
| bracketPair | Bracket pair | [curvature] | [16667] |

## Ribbons

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| ribbon | Down-curved ribbon | [fold height, ribbon curvature] | [16667, 50000] |
| ribbon2 | Up-curved ribbon | [fold height, ribbon curvature] | [16667, 50000] |
| ellipseRibbon | Curved-surface down ribbon | [curvature, middle height, fold height] | [25000, 50000, 12500] |
| ellipseRibbon2 | Curved-surface up ribbon | [curvature, middle height, fold height] | [25000, 50000, 12500] |
| leftRightRibbon | Left-right ribbon | [fold height, ribbon curvature, fold width] | [50000, 50000, 16667] |

## Scrolls

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| horizontalScroll | Horizontal scroll | [scroll size] | [12500] |
| verticalScroll | Vertical scroll | [scroll size] | [12500] |

## Math Symbols

| shapeName | Description | adjustments parameters | Default values |
| --------- | --- | -------------- | ---- |
| mathPlus | Plus sign | [line thickness] | [23520] |
| mathMinus | Minus sign | [line thickness] | [23520] |
| mathMultiply | Multiplication sign | [line thickness] | [23520] |
| mathDivide | Division sign | [line thickness, dot spacing, dot size] | [23520, 5880, 11760] |
| mathEqual | Equal sign | [line thickness, line spacing] | [23520, 11760] |
| mathNotEqual | Not-equal sign | [line thickness, slash angle°, line spacing] | [23520, 6600000, 11760] |

## Chart Shapes

| shapeName | Description |
| --------- | --- |
| chartPlus | Chart plus |
| chartStar | Chart star |
| chartX | Chart X |

## Tab Shapes

| shapeName | Description |
| --------- | --- |
| cornerTabs | Corner tabs |
| squareTabs | Square tabs |
| plaqueTabs | Plaque tabs |

## Action Buttons

| shapeName | Description |
| --------- | --- |
| actionButtonBackPrevious | Back/Previous button |
| actionButtonBeginning | Beginning button |
| actionButtonBlank | Blank button |
| actionButtonDocument | Document button |
| actionButtonEnd | End button |
| actionButtonForwardNext | Forward/Next button |
| actionButtonHelp | Help button |
| actionButtonHome | Home button |
| actionButtonInformation | Information button |
| actionButtonMovie | Movie button |
| actionButtonReturn | Return button |
| actionButtonSound | Sound button |

## Flowchart Shapes

| shapeName | Description |
| --------- | --- |
| flowChartProcess | Flowchart: Process |
| flowChartAlternateProcess | Flowchart: Alternate process |
| flowChartDecision | Flowchart: Decision |
| flowChartDocument | Flowchart: Document |
| flowChartMultidocument | Flowchart: Multidocument |
| flowChartInputOutput | Flowchart: Data |
| flowChartPredefinedProcess | Flowchart: Predefined process |
| flowChartInternalStorage | Flowchart: Internal storage |
| flowChartManualInput | Flowchart: Manual input |
| flowChartManualOperation | Flowchart: Manual operation |
| flowChartPreparation | Flowchart: Preparation |
| flowChartDelay | Flowchart: Delay |
| flowChartTerminator | Flowchart: Terminator |
| flowChartConnector | Flowchart: Connector |
| flowChartOffpageConnector | Flowchart: Off-page connector |
| flowChartPunchedCard | Flowchart: Punched card |
| flowChartPunchedTape | Flowchart: Punched tape |
| flowChartCollate | Flowchart: Collate |
| flowChartSort | Flowchart: Sort |
| flowChartExtract | Flowchart: Extract |
| flowChartMerge | Flowchart: Merge |
| flowChartOr | Flowchart: Or |
| flowChartSummingJunction | Flowchart: Summing junction |
| flowChartOnlineStorage | Flowchart: Online storage |
| flowChartMagneticDisk | Flowchart: Magnetic disk |
| flowChartMagneticDrum | Flowchart: Magnetic drum |
| flowChartMagneticTape | Flowchart: Magnetic tape |
| flowChartOfflineStorage | Flowchart: Offline storage |
| flowChartDisplay | Flowchart: Display |
