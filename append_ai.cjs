const fs = require('fs');

const serviceCode = `
export async function generateAiReport(tenantId: string, userId: string, data: { prompt: string }) {
  const provider = await prisma.provider.findFirst({
    where: { tenantId }
  })

  if (!provider) throw { statusCode: 404, message: 'Provider not found' }

  const ops = decryptOperationalSettings(provider.operationalSettings)
  const aiConfig = ops?.ai

  if (!aiConfig || !aiConfig.provider || aiConfig.provider === 'none' || !aiConfig.apiKey) {
    throw { statusCode: 400, message: 'AI configuration is missing or disabled' }
  }

  let reportText = ''

  try {
    if (aiConfig.provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${aiConfig.apiKey}\`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: data.prompt }]
        })
      })
      const resData = await response.json()
      if (resData.error) throw new Error(resData.error.message)
      reportText = resData.choices[0].message.content
    } else if (aiConfig.provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': aiConfig.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1000,
          messages: [{ role: 'user', content: data.prompt }]
        })
      })
      const resData = await response.json()
      if (resData.error) throw new Error(resData.error.message)
      reportText = resData.content[0].text
    } else if (aiConfig.provider === 'gemini') {
      const response = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=\${aiConfig.apiKey}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: data.prompt }] }]
        })
      })
      const resData = await response.json()
      if (resData.error) throw new Error(resData.error.message)
      reportText = resData.candidates[0].content.parts[0].text
    } else {
      throw { statusCode: 400, message: 'Unsupported AI provider' }
    }

    // Save to database
    const savedReport = await prisma.aiReport.create({
      data: {
        tenantId,
        providerName: provider.businessName,
        prompt: data.prompt,
        report: reportText
      }
    })

    return savedReport
  } catch (err: any) {
    throw { statusCode: 500, message: 'Failed to generate report: ' + (err.message || 'Unknown error') }
  }
}

export async function getAiReports(tenantId: string) {
  return prisma.aiReport.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 20
  })
}
`;

fs.appendFileSync('src/modules/providers/providers.service.ts', serviceCode);
