import re

with open('api/index.js', 'r') as f:
    content = f.read()

# Helper to remove blocks based on start and end markers
def remove_block(text, start_pattern, end_pattern):
    return re.sub(start_pattern + r'.*?' + end_pattern, '', text, flags=re.DOTALL | re.MULTILINE)

# 1. Remove migrateGroupSchema function and call
content = re.sub(r'const migrateGroupSchema = async \(\) => \{.*?^\};' , '', content, flags=re.DOTALL | re.MULTILINE)
content = re.sub(r'migrateGroupSchema\(\)\.catch\(.*?\);', '', content)

# 2. Remove Group Dating Helper Functions section
content = re.sub(r'// --- Group Dating Helper Functions ---.*?// --- Discovery & Actions ---', '// --- Discovery & Actions ---', content, flags=re.DOTALL)

# 3. Remove Group Dating Flow in message handler
content = re.sub(r'// --- Group Dating Flow ---.*?bot\.command\(\'deleteaccount\'', "bot.command('deleteaccount'", content, flags=re.DOTALL)

# 4. Remove Group Dating Commands section
content = re.sub(r'// --- Group Dating Commands ---.*?// Admin commands', '// Admin commands', content, flags=re.DOTALL)

# 5. Remove Group Dating Action Handlers section
content = re.sub(r'// --- Group Dating Action Handlers ---.*?async function handleChat\(ctx, user\) \{', 'async function handleChat(ctx, user) {', content, flags=re.DOTALL)

# 6. Remove group chat mode in bot.on('message')
content = re.sub(r'// Handle group chat mode - proxy message routing for group chats.*?// Handle chat mode', '// Handle chat mode', content, flags=re.DOTALL)

# 7. Remove '👯‍♀️ Group Dating' from RESERVED_USER_INPUTS
content = content.replace("'👯‍♀️ Group Dating', ", "")

# 8. Cleanup handleChat
# Remove the entire block for '👯‍♀️ Group Dating' button
content = re.sub(r'// Handle Group Dating button click.*?if \(text === \'🔙 Back to Main Menu\'\)', 'if (text === \'🔙 Back to Main Menu\')', content, flags=re.DOTALL)
# Remove other group buttons in handleChat
content = re.sub(r'if \(text === \'🆕 Create Group\'\).*?if \(user\.step === \'ask_interests\'', "if (user.step === 'ask_interests'", content, flags=re.DOTALL)

# 9. Remove group stats from admin dashboard
content = re.sub(r'\{/\* Group Dating Statistics \*/\}.*?</div>', '', content, flags=re.DOTALL)

# 10. Remove '👯‍♀️ Group Dating' from all keyboards
content = content.replace("'👯‍♀️ Group Dating', ", "")
content = content.replace(", '👯‍♀️ Group Dating'", "")
content = content.replace("'👯‍♀️ Group Dating'", "")

# Cleanup double commas and empty keyboard rows
content = re.sub(r'\[\s*,', '[', content)
content = re.sub(r',\s*\]', ']', content)

with open('api/index.js', 'w') as f:
    f.write(content)
