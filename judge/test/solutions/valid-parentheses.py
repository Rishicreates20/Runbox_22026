s = input() if True else ""
st = []; m = {')': '(', ']': '[', '}': '{'}; ok = True
for c in s:
    if c in '([{': st.append(c)
    elif not st or st.pop() != m[c]: ok = False; break
print("true" if ok and not st else "false")
