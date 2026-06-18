import re

with open('api/index.js', 'r') as f:
    content = f.read()

# Remove the broken group stats block
content = re.sub(r'<div className="bg-white rounded-xl shadow-md p-6">\s*<h3 className="text-lg font-semibold mb-4">👯‍♀️ Group Dating Statistics</h3>.*?</div>\s*</div>', '', content, flags=re.DOTALL)

# Let's try a simpler one for the remaining fragments
content = re.sub(r'<div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 text-center">.*?<p className="text-xs text-gray-600">Group Likes</p>\s*</div>\s*</div>\s*</div>', '', content, flags=re.DOTALL)

with open('api/index.js', 'w') as f:
    f.write(content)
