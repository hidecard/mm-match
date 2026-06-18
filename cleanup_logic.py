import re

with open('api/index.js', 'r') as f:
    content = f.read()

# Remove group statistics database queries
content = re.sub(r'// Group statistics.*?totalGroupLikes', 'totalLikes', content, flags=re.DOTALL)
# Actually let's just remove the lines
lines = content.split('\n')
new_lines = []
skip = False
for line in lines:
    if '// Group statistics' in line:
        skip = True
        continue
    if skip and 'totalGroupLikes' in line:
        skip = False
        continue
    if skip:
        continue
    if 'totalGroups:' in line or 'totalGroupMembers:' in line or 'totalGroupMatches:' in line or 'totalGroupLikes:' in line:
        continue
    new_lines.append(line)

content = '\n'.join(new_lines)

with open('api/index.js', 'w') as f:
    f.write(content)
