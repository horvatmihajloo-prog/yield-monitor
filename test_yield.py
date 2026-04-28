import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait


BASE_URL = "http://localhost:8000"
TARGET_PART = "001PN001"


def run_test():
    driver = webdriver.Chrome()
    wait = WebDriverWait(driver, 10)

    try:
        driver.get(BASE_URL)
        wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, f'#partLegend [data-part="{TARGET_PART}"]'))
        ).click()

        tested_before = int(driver.find_element(By.ID, "testedVal").text.strip())
        passed_before = int(driver.find_element(By.ID, "passedVal").text.strip())

        records = [
            ("SER001", True),
            ("SER002", True),
            ("SER003", True),
            ("SER004", False),
            ("SER005", False),
        ]

        for serial, is_pass in records:
            wait.until(EC.element_to_be_clickable((By.ID, "manualTestBtn"))).click()
            serial_input = wait.until(EC.presence_of_element_located((By.ID, "serialNumber")))
            serial_input.clear()
            serial_input.send_keys(serial)

            part_select = Select(driver.find_element(By.ID, "partNumber"))
            part_select.select_by_value(TARGET_PART)

            status_checkbox = driver.find_element(By.ID, "statusCheckbox")
            if status_checkbox.is_selected() != is_pass:
                status_checkbox.click()

            driver.find_element(By.ID, "addTestBtn").click()
            time.sleep(0.4)

        wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, f'#partLegend [data-part="{TARGET_PART}"]'))
        ).click()
        time.sleep(1)

        yield_text = driver.find_element(By.ID, "yieldText").text.strip().replace("%", "")
        actual = float(yield_text)
        expected = round(((passed_before + 3) / (tested_before + 5)) * 100, 1)

        if abs(actual - expected) < 0.1:
            print(f"PASS: Expected {expected}%, got {actual}%")
        else:
            print(f"FAIL: Expected {expected}%, got {actual}%")
    finally:
        driver.quit()


if __name__ == "__main__":
    run_test()
