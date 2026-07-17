#!/bin/bash

echo "🔍 Validating Remotion Video Generator Plugin..."
echo ""

# Check plugin.json
if [ -f ".codebuddy-plugin/plugin.json" ]; then
    echo "✓ plugin.json exists"
else
    echo "❌ plugin.json missing"
    exit 1
fi

# Check skills
SKILLS=("video-generator" "scene-planner" "environment-setup" "remotion-best-practices")
for skill in "${SKILLS[@]}"; do
    if [ -f "skills/$skill/SKILL.md" ]; then
        echo "✓ Skill: $skill"
    else
        echo "❌ Skill missing: $skill"
        exit 1
    fi
done

# Check templates
TEMPLATES=("explainer-video.md" "product-demo.md" "social-media.md" "presentation.md")
for template in "${TEMPLATES[@]}"; do
    if [ -f "templates/$template" ]; then
        echo "✓ Template: $template"
    else
        echo "❌ Template missing: $template"
        exit 1
    fi
done

# Check README
if [ -f "README.md" ]; then
    echo "✓ README.md exists"
else
    echo "❌ README.md missing"
fi

echo ""
echo "✅ Plugin structure validation complete!"
echo ""
echo "Plugin details:"
cat .codebuddy-plugin/plugin.json | grep -E '"name"|"version"|"description"' | head -3

