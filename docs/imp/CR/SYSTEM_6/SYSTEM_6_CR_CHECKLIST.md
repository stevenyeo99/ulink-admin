Before UAT pass to Vundick to access dashboard

1. During click the case link, if already login on the browser can it go to the case instead of re-login everytime?

2. increase the LLM API call, because the LM Studio machine also being used by other Client, it might face timeout.

3. for case that are still progress end to end, don't display it on case list (like case not yet OCR, member check, document check, claim prep, claim api submit), only show that the step that already park.

4. analyse make sure during document check phase make sure not confusing user, because API case is go to claim preparation payload as well (i find this part little confuse for me/end user what is the system situation)
-> to make sure user understand what is the current case stage situation