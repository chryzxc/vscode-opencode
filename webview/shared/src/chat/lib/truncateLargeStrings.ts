export function truncateLargeStrings(obj: any, maxLen: number = 200000): any {
  if (typeof obj === "string") {
    return obj.length > maxLen ? obj.slice(0, maxLen) + "\n...[truncated " + (obj.length - maxLen) + " chars]" : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => truncateLargeStrings(item, maxLen));
  }
  if (obj !== null && typeof obj === "object") {
    const newObj: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = truncateLargeStrings(obj[key], maxLen);
      }
    }
    return newObj;
  }
  return obj;
}
