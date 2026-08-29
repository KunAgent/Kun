# Connector rules

1. Off-axis nodes use rounded orthogonal paths with 6–8px bend radius. Straight lines are only for shared x/y axes.
2. Connector labels sit beside the path. Their opaque mask never touches the stroke; keep 6–10px visible clearance.
3. No overlapping paths. Offset parallel routes by at least 12px. Use a bridge/hop for a necessary crossing.
4. Fan attachment points. For N connectors on an edge of length L, connector k attaches at `L*k/(N+1)`. Keep adjacent points at least 12px apart.
5. Reroute around non-endpoint nodes. Only geometrically unavoidable transit may cross a node; render it dashed and keep the label on a visible segment.
6. A label mask must not overlap a node painted later. Put labels on open canvas.
7. Draw zones first, connectors and labels second, nodes last, and a legend only when it adds information.
8. Each connector carries information. Remove it when layout already makes the relationship obvious.
