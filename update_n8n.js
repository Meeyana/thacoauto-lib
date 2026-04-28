const fs = require('fs');

try {
  const data = JSON.parse(fs.readFileSync('n8n-workflow-actual.json', 'utf8'));
  const salesLeadCode = fs.readFileSync('snippets/sales_lead_code.js', 'utf8');

  for (const node of data.nodes) {
    if (node.name === 'xu_ly_category') {
      if (!node.parameters.jsCode.includes('price_sort')) {
        node.parameters.jsCode = node.parameters.jsCode.replace(
          'budget_max: p.budget_max ? Number(p.budget_max) : null,',
          'budget_max: p.budget_max ? Number(p.budget_max) : null,\n      price_sort: (p.price_sort || "").toLowerCase().trim() || null,'
        );
      }
    }
    if (node.name === 'Code in JavaScript') {
      node.parameters.jsCode = salesLeadCode;
    }
    if (node.name === 'AI Agent' && node.parameters.options && node.parameters.options.systemMessage) {
      let msg = node.parameters.options.systemMessage;
      if (!msg.includes('price_sort')) {
        msg = msg.replace(
          '7. use_case',
          '7. price_sort: Nếu khách muốn tìm xe theo giá. "asc" (rẻ nhất, thấp nhất), "desc" (đắt nhất, cao nhất, mắc nhất). Nếu không có -> null.\n8. use_case'
        );
        msg = msg.replace('8. qa_intents', '9. qa_intents');
        msg = msg.replace('9. compare_with_brand', '10. compare_with_brand');
        msg = msg.replace('10. compare_with_model', '11. compare_with_model');
        msg = msg.replace('11. compare_target', '12. compare_target');
        msg = msg.replace('12. sales_subcategory', '13. sales_subcategory');
        
        msg = msg.replace(
          '"budget_max":null,"use_case"',
          '"budget_max":null,"price_sort":null,"use_case"'
        );
        node.parameters.options.systemMessage = msg;
      }
    }
    if (node.name === 'Normalize Entities') {
      // Normalize entities might not need changes because price_sort is just "asc"/"desc", but let's check it.
      // Wait, no need to touch Normalize Entities.
    }
  }

  fs.writeFileSync('n8n-workflow-actual.json', JSON.stringify(data, null, 4));
  console.log('Successfully updated n8n-workflow-actual.json');
} catch (e) {
  console.error(e);
}
