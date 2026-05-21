const MOBILE_NUMBER_LENGTH = 10;

function digitsOnly(value = '') {
  return String(value).replace(/\D/g, '');
}

function normalizeMobileNumber(value = '') {
  return digitsOnly(value);
}

function isValidMobileNumber(value = '') {
  return normalizeMobileNumber(value).length === MOBILE_NUMBER_LENGTH;
}

module.exports = {
  MOBILE_NUMBER_LENGTH,
  normalizeMobileNumber,
  isValidMobileNumber
};
