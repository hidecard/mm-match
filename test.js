// test-ai.js

// ၁။ ဆရာ့ရဲ့ Cloudflare Credentials များကို ဒီနေရာတွင် တိုက်ရိုက်ထည့်ပါ
const CLOUDFLARE_ACCOUNT_ID = "b705ecc1317667a3d3d268b5c9973d55";
const CLOUDFLARE_API_TOKEN = "cfut_VQTFIDHVoQASaeEZmvwcePibTP7gAEclAmJ6gsymba72c218"; // ဆရာဆောက်ထားတဲ့ Token အသစ်ကို ဒီမှာထည့်ပါ

async function runTest() {
  console.log("🚀 Cloudflare Workers AI ကို (No .env) စတင်စမ်းသပ်နေပါပြီ...");
  
  const model = "@cf/meta/llama-3-8b-instruct"; 
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;

  const requestBody = {
    messages: [
      { 
        role: "system", 
        content: "You are a friendly assistant for MM Cupid Telegram Bot." 
      },
      { 
        role: "user", 
        content: "Say hello to my programming students!" 
      }
    ]
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (data.success) {
      console.log("\n✅ AI ချက်ဆက်မှု အောင်မြင်ပါတယ်!");
      console.log("🤖 AI ရဲ့ အဖြေ:");
      console.log("-----------------------------------------");
      console.log(data.result.response);
      console.log("-----------------------------------------");
    } else {
      console.error("\n❌ Cloudflare AI Error ပြန်ကျလာပါတယ်:");
      console.error(JSON.stringify(data.errors, null, 2));
    }
  } catch (error) {
    console.error("\n❌ Request ခေါ်ဆိုမှု အမှားအယွင်းရှိပါသည်:");
    console.error(error.message);
  }
}

runTest();